/*
 * This file is part of NFeWizard-io.
 *
 * NFeWizard-io is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * NFeWizard-io is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with NFeWizard-io. If not, see <https://www.gnu.org/licenses/>.
 */
import { generateKeyPairSync, createVerify } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Environment, mascararSegredos } from '@nfewizard/shared';
import { NFCEAutorizacaoService } from '../NFCEAutorizacaoService';
import { destinatarioQRCodeV3, generateQRCodeV3URLOffline, generateQRCodeV3URLOnline, textoQRCodeV3Offline } from '../util/NFCEQRCode';
import { resultadoDaAutorizacao, resultadoDoErro } from '../util/NFCEResultado';

const CHAVE = '33261111222333000181650010000000071123456780';
const utility: any = { getUrlNFCe: () => 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode' };

describe('Correção 1: segredos fora do log e do cabeçalho HTTP', () => {
    it('mascara senha do certificado, CSC e CSRT em qualquer profundidade, sem alterar o original', () => {
        const original = {
            config: { pathCertificado: '/c.pfx', senhaCertificado: 'minha-senha', ambiente: 2 },
            headers: { 'Content-Type': 'text/xml', SOAPAction: 'x', CSC: 'TOKEN-CSC' },
            nfe: { idCSC: 1, tokenCSC: 'TOKEN-CSC', CSRT: 'CSRT-SECRETO' },
            lista: [{ password: 'p' }],
        };
        const m = mascararSegredos(original);
        const texto = JSON.stringify(m);
        expect(texto).not.toContain('minha-senha');
        expect(texto).not.toContain('TOKEN-CSC');
        expect(texto).not.toContain('CSRT-SECRETO');
        expect(texto).not.toContain('"password":"p"');
        expect(m.config.pathCertificado).toBe('/c.pfx');
        expect(m.nfe.idCSC).toBe(1);
        expect(original.config.senhaCertificado).toBe('minha-senha');
        expect(original.headers.CSC).toBe('TOKEN-CSC');
    });

    it('não manda o CSC em cabeçalho na autorização', async () => {
        const service: any = new (NFCEAutorizacaoService as any)();
        const post = jest.fn(async () => ({ data: '<ok/>' }));
        service.axios = { post };
        service.environment = { getConfig: () => ({ nfe: { idCSC: 1, tokenCSC: 'TOKEN-CSC' } }) };
        service.metodo = 'NFEAutorizacao';
        await service.callWebService('<xml/>', 'https://sefaz', 'text/xml', 'acao', {});
        const headers = (post.mock.calls[0] as any[])[2].headers;
        expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('csc');
        expect(JSON.stringify(headers)).not.toContain('TOKEN-CSC');
    });
});

describe('Correção 2: bloco `nfce` da config (como no README) funciona', () => {
    it('só `nfce`: vira `nfe`', () => {
        const env = new Environment({ dfe: { pathCertificado: 'x', senhaCertificado: 'y', UF: 'RJ', CPFCNPJ: '1' }, nfce: { ambiente: 2, versaoDF: '4.00', idCSC: 1, tokenCSC: 'T' } } as any);
        expect(env.getConfig().nfe).toMatchObject({ ambiente: 2, idCSC: 1, tokenCSC: 'T' });
    });

    it('`nfe` e `nfce`: `nfe` prevalece e `nfce` completa o CSC', () => {
        const env = new Environment({ dfe: {}, nfe: { ambiente: 1, versaoDF: '4.00' }, nfce: { ambiente: 2, idCSC: 3, tokenCSC: 'T' } } as any);
        expect(env.getConfig().nfe).toMatchObject({ ambiente: 1, idCSC: 3, tokenCSC: 'T' });
    });
});

describe('Correção 3: resultado estruturado da autorização', () => {
    const prot = (cStat: string, nProt = '333260000000001') => ({ xmls: [{ protNFe: { infProt: { cStat, xMotivo: cStat === '100' ? 'Autorizado o uso da NF-e' : 'Uso Denegado', nProt, chNFe: CHAVE, dhRecbto: '2026-11-16T10:00:01-03:00' } } }], xMotivo: [] });

    it('autorizada só com cStat 100/150, com protocolo e chave', () => {
        const r = resultadoDaAutorizacao(prot('100'));
        expect(r).toMatchObject({ situacao: 'autorizada', autorizada: true, cStat: 100, protocolo: '333260000000001', chave: CHAVE });
    });

    it('denegada guarda o protocolo, mas não é autorizada', () => {
        expect(resultadoDaAutorizacao(prot('302'))).toMatchObject({ situacao: 'denegada', autorizada: false, cStat: 302 });
    });

    it('contingência NÃO é autorização: sem cStat 000 nem protocolo "CONTINGENCIA"', () => {
        const r = resultadoDaAutorizacao({
            success: true, emContingencia: true,
            xMotivo: [{ chNFe: CHAVE, cStat: '000', xMotivo: 'NFC-e gerada em Contingência Off-line (tpEmis=9)' }],
            xmls: [{ protNFe: { infProt: { cStat: '000', nProt: 'CONTINGENCIA' } } }],
        });
        expect(r).toMatchObject({ situacao: 'contingencia_pendente', autorizada: false, cStat: null, protocolo: null, chave: CHAVE, emContingencia: true });
    });

    it('rejeição lançada pela biblioteca mantém o cStat; sem cStat é erro (situação incerta)', () => {
        expect(resultadoDoErro(Object.assign(new Error('Rejeicao: Falha no Schema XML'), { cStat: 225 }))).toMatchObject({ situacao: 'rejeitada', cStat: 225, autorizada: false });
        expect(resultadoDoErro(Object.assign(new Error('Uso Denegado'), { cStat: 301 }))).toMatchObject({ situacao: 'denegada' });
        expect(resultadoDoErro(new Error('connect ECONNREFUSED'))).toMatchObject({ situacao: 'erro', cStat: null, autorizada: false });
    });
});

describe('Correção 4: QR Code v3 (NT 2025.001)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const xsd = fs.readFileSync(path.resolve(__dirname, '../../../../../shared/resources/schemas/leiauteNFe_v4.00.xsd'), 'utf8');
    const trecho = xsd.slice(xsd.indexOf('name="qrCode"'), xsd.indexOf('name="urlChave"'));
    const padroes = [...trecho.matchAll(/<xs:pattern value="([^"]+)"\/>/g)].map((m) => new RegExp('^(?:' + m[1].replace(/&amp;/g, '&') + ')$'));
    const passaNoXsd = (qr: string) => qr.length >= 60 && qr.length <= 1000 && padroes.some((p) => p.test(qr));

    it('on-line: chave|3|tpAmb, sem CSC e sem hash', () => {
        const qr = generateQRCodeV3URLOnline('NFe' + CHAVE, 2, utility);
        expect(qr).toBe(`https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${CHAVE}|3|2`);
        expect(passaNoXsd(qr)).toBe(true);
    });

    it('off-line: 7 parâmetros + assinatura RSA-SHA1 Base64 do certificado, que confere com a chave pública', () => {
        const dest = destinatarioQRCodeV3({ CPF: '52998224725' });
        const chave9 = CHAVE.slice(0, 34) + '9' + CHAVE.slice(35);
        const qr = generateQRCodeV3URLOffline(chave9, 2, '16', '10.00', dest, privateKey, utility);
        const p = qr.split('?p=')[1].split('|');
        expect(p.slice(0, 7)).toEqual([chave9, '3', '2', '16', '10.00', '2', '52998224725']);
        const assinado = textoQRCodeV3Offline(chave9, 2, '16', '10.00', dest);
        expect(createVerify('RSA-SHA1').update(assinado).verify(publicKey, p[7], 'base64')).toBe(true);
        expect(passaNoXsd(qr)).toBe(true);
    });

    it('off-line sem destinatário: tp_idDest e idDest vazios, só os separadores', () => {
        const chave9 = CHAVE.slice(0, 34) + '9' + CHAVE.slice(35);
        const qr = generateQRCodeV3URLOffline(chave9, 1, '05', '0.50', destinatarioQRCodeV3(null), privateKey, utility);
        expect(qr).toContain(`?p=${chave9}|3|1|05|0.50|||`);
        expect(passaNoXsd(qr)).toBe(true);
    });

    it('CNPJ vira tp_idDest 1', () => {
        expect(destinatarioQRCodeV3({ CNPJ: '11222333000181' })).toEqual({ tpIdDest: '1', idDest: '11222333000181' });
    });

    it('o XSD continua aceitando a v2 e recusa v3 com versão ou assinatura inválida', () => {
        expect(passaNoXsd(`https://x/qr?p=${CHAVE}|2|2|1|${'a'.repeat(40)}`)).toBe(true);
        expect(passaNoXsd(`https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${CHAVE}|4|2`)).toBe(false);
        const chave9 = CHAVE.slice(0, 34) + '9' + CHAVE.slice(35);
        expect(passaNoXsd(`https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${chave9}|3|2|16|10.00|2|52998224725|não-é-base64!`)).toBe(false);
    });

    it('dia da emissão sai do próprio dhEmi, não do fuso do servidor', () => {
        const service: any = new (NFCEAutorizacaoService as any)();
        expect(service.diaEmissao('2026-11-16T23:30:00-03:00')).toBe('16');
        expect(service.diaEmissao('2026-11-01T00:10:00-03:00')).toBe('01');
    });
});
