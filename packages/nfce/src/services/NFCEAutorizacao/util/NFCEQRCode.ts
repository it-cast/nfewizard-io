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

import { Utility } from '@nfewizard/shared';
import { createHash, createSign } from 'crypto';
import sha1 from 'sha1';

// Função para gerar o hash SHA-1 em formato hexadecimal
function generateSHA1Hash(input: string): string {
    return createHash('sha1').update(input).digest('hex');
}

function calcularDigestValueHex(digVal: string): string {
    return Buffer.from(digVal).toString('hex');
}

// Função para gerar a URL do QR Code para emissão ONLINE
export function generateQRCodeURLOnline(
    chaveAcesso: string,
    versaoQRCode: string,
    tipoAmbiente: number,
    identificadorCSC: number,
    csc: string,
    utility: Utility
): string {
    const urlQRCodeNFCe = utility.getUrlNFCe('URL-QRCode', false, '');
    chaveAcesso = chaveAcesso.replace('NFe', '');

    // Passo 1: Concatenar parâmetros
    const baseString = `${chaveAcesso}|${versaoQRCode}|${tipoAmbiente}|${identificadorCSC}`;

    // Passo 2: Adicionar o CSC
    const stringToHash = `${baseString}${csc}`;

    // Passo 3: Gerar o hash
    const codigoHash = generateSHA1Hash(stringToHash);

    // Montar a URL final
    return `${urlQRCodeNFCe}?p=${baseString}|${codigoHash}`;
}

// Função para gerar a URL do QR Code para emissão OFFLINE
export function generateQRCodeURLOffline(
    chaveAcesso: string,
    versaoQRCode: string,
    tipoAmbiente: number,
    diaDataEmissao: string,
    valorTotalNfce: string,
    digVal: string,
    identificadorCSC: number,
    csc: string,
    utility: Utility
): string {
    const urlQRCodeNFCe = utility.getUrlNFCe('URL-QRCode', false, '');
    chaveAcesso = chaveAcesso.replace('NFe', '');

    // Passo 1: Converter DigestValue para HEXA
    const digestValueHex = calcularDigestValueHex(digVal)

    // Passo 2: Concatenar parâmetros
    const baseString = `${chaveAcesso}|${versaoQRCode}|${tipoAmbiente}|${diaDataEmissao}|${valorTotalNfce}|${digestValueHex}|${identificadorCSC}`;

    // Passo 3: Adicionar o CSC
    const stringToHash = `${baseString}${csc}`;

    // Passo 4: Gerar o hash
    const hash = sha1(stringToHash).toUpperCase();

    // Montar URL
    return `${urlQRCodeNFCe}?p=${baseString}|${hash}`;
}

/** Destinatário do QR Code v3 off-line: tp_idDest 1 = CNPJ, 2 = CPF; sem destinatário (ou estrangeiro) os dois campos ficam vazios */
export interface DestinatarioQRCodeV3 {
    tpIdDest: '' | '1' | '2' | '3';
    idDest: string;
}

/** Destinatário a partir do grupo `dest` já normalizado (CNPJ/CPF/idEstrangeiro) */
export function destinatarioQRCodeV3(dest?: { CNPJ?: string; CPF?: string } | null): DestinatarioQRCodeV3 {
    const cnpj = String(dest?.CNPJ ?? '').trim();
    if (cnpj) return { tpIdDest: '1', idDest: cnpj };
    const cpf = String(dest?.CPF ?? '').trim();
    if (cpf) return { tpIdDest: '2', idDest: cpf };
    return { tpIdDest: '', idDest: '' };
}

/**
 * QR Code versão 3, emissão ON-LINE (NT 2025.001): `?p=<chave>|3|<tpAmb>`. Não usa CSC nem hash.
 */
export function generateQRCodeV3URLOnline(chaveAcesso: string, tipoAmbiente: number, utility: Utility): string {
    const urlQRCodeNFCe = utility.getUrlNFCe('URL-QRCode', false, '');
    return `${urlQRCodeNFCe}?p=${chaveAcesso.replace('NFe', '')}|3|${tipoAmbiente}`;
}

/** Parâmetros 1 a 7 do QR Code v3 off-line, com os separadores (é o texto assinado) */
export function textoQRCodeV3Offline(chaveAcesso: string, tipoAmbiente: number, diaDataEmissao: string, valorTotalNfce: string, dest: DestinatarioQRCodeV3): string {
    return `${chaveAcesso.replace('NFe', '')}|3|${tipoAmbiente}|${diaDataEmissao}|${valorTotalNfce}|${dest.tpIdDest}|${dest.idDest}`;
}

/**
 * QR Code versão 3, CONTINGÊNCIA OFF-LINE (tpEmis 9, NT 2025.001 / Manual do DANFE NFC-e):
 * `?p=<chave>|3|<tpAmb>|<dia>|<vNF>|<tp_idDest>|<idDest>|<assinatura>`, onde a assinatura é RSA-SHA1 em Base64 dos parâmetros 1 a 7
 * (com os "|"), feita com a chave privada do MESMO certificado que assina a NFC-e. Não usa CSC.
 */
export function generateQRCodeV3URLOffline(
    chaveAcesso: string,
    tipoAmbiente: number,
    diaDataEmissao: string,
    valorTotalNfce: string,
    dest: DestinatarioQRCodeV3,
    chavePrivadaPem: string,
    utility: Utility
): string {
    const urlQRCodeNFCe = utility.getUrlNFCe('URL-QRCode', false, '');
    const texto = textoQRCodeV3Offline(chaveAcesso, tipoAmbiente, diaDataEmissao, valorTotalNfce, dest);
    const assinatura = createSign('RSA-SHA1').update(texto, 'utf8').sign(chavePrivadaPem, 'base64');
    return `${urlQRCodeNFCe}?p=${texto}|${assinatura}`;
}
