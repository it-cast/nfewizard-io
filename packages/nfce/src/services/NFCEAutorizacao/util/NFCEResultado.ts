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

/**
 * Situação fiscal de uma NFC-e depois de uma tentativa de autorização.
 * - autorizada: a SEFAZ autorizou (cStat 100 ou 150). Só aqui `protocolo` é um protocolo de verdade.
 * - rejeitada: a SEFAZ recusou; corrigir e emitir de novo (a numeração pode precisar de inutilização).
 * - denegada: uso denegado (110, 205, 301, 302, 303); a nota existe na SEFAZ e não pode ser usada.
 * - contingencia_pendente: gerada off-line (tpEmis 4/9) e NÃO transmitida. Não é autorização: transmitir depois.
 * - erro: não houve resposta fiscal (rede, timeout, certificado, XML). Situação incerta: consultar pela chave antes de emitir de novo.
 */
export type SituacaoNFCe = 'autorizada' | 'rejeitada' | 'denegada' | 'contingencia_pendente' | 'erro';

export interface ResultadoAutorizacaoNFCe {
    situacao: SituacaoNFCe;
    /** true somente com autorização real da SEFAZ */
    autorizada: boolean;
    cStat: number | null;
    xMotivo: string;
    chave: string | null;
    /** nProt da SEFAZ. Nunca o marcador interno "CONTINGENCIA" */
    protocolo: string | null;
    dhRecbto: string | null;
    emContingencia: boolean;
    /** XML assinado (e, quando autorizada, a resposta da SEFAZ) */
    xmls: unknown[];
}

const AUTORIZADA = new Set([100, 150]);
const DENEGADA = new Set([110, 205, 301, 302, 303]);

const primeiro = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const texto = (v: unknown): string | null => {
    const p = primeiro(v);
    if (p === undefined || p === null) return null;
    const s = String(typeof p === 'object' && p !== null && '_' in (p as object) ? (p as { _: unknown })._ : p).trim();
    return s === '' ? null : s;
};
const numero = (v: unknown): number | null => {
    const s = texto(v);
    return s && /^\d+$/.test(s) ? Number(s) : null;
};

function situacaoDoCStat(cStat: number | null): SituacaoNFCe {
    if (cStat === null) return 'erro';
    if (AUTORIZADA.has(cStat)) return 'autorizada';
    if (DENEGADA.has(cStat)) return 'denegada';
    return 'rejeitada';
}

/** Resultado estruturado a partir do retorno de `NFCEAutorizacaoService.Exec`/`ExecTransmitirContingencia` */
export function resultadoDaAutorizacao(resp: { success?: boolean; emContingencia?: boolean; xMotivo?: unknown; xmls?: unknown[] }): ResultadoAutorizacaoNFCe {
    const xmls = Array.isArray(resp?.xmls) ? resp.xmls : [];
    const primeiroXml = (xmls[0] ?? {}) as { protNFe?: unknown };
    const prot = primeiro((primeiroXml.protNFe as { infProt?: unknown } | undefined)?.infProt ?? primeiro(primeiroXml.protNFe)) as Record<string, unknown> | undefined;
    const motivos = Array.isArray(resp?.xMotivo) ? resp.xMotivo as Record<string, unknown>[] : [];

    if (resp?.emContingencia) {
        return {
            situacao: 'contingencia_pendente', autorizada: false, cStat: null,
            xMotivo: texto(motivos[0]?.xMotivo) ?? 'NFC-e gerada em contingência: transmitir para autorização.',
            chave: texto(motivos[0]?.chNFe) ?? texto(prot?.chNFe), protocolo: null, dhRecbto: null, emContingencia: true, xmls,
        };
    }

    const cStat = numero(prot?.cStat) ?? numero(motivos[0]?.cStat);
    const situacao = situacaoDoCStat(cStat);
    return {
        situacao,
        autorizada: situacao === 'autorizada',
        cStat,
        xMotivo: texto(prot?.xMotivo) ?? texto(motivos[0]?.xMotivo) ?? '',
        chave: texto(prot?.chNFe) ?? texto(motivos[0]?.chNFe),
        protocolo: situacao === 'autorizada' || situacao === 'denegada' ? texto(prot?.nProt) : null,
        dhRecbto: texto(prot?.dhRecbto),
        emContingencia: false,
        xmls,
    };
}

/** Resultado estruturado a partir de um erro lançado na autorização (rejeição traz `cStat`; sem ele é falha de comunicação/montagem) */
export function resultadoDoErro(erro: unknown): ResultadoAutorizacaoNFCe {
    const e = erro as { message?: unknown; cStat?: unknown; xMotivo?: unknown };
    const cStat = typeof e?.cStat === 'number' ? e.cStat : numero(e?.cStat);
    const situacao = situacaoDoCStat(cStat);
    return {
        situacao,
        autorizada: false,
        cStat,
        xMotivo: texto(e?.xMotivo) ?? String(e?.message ?? erro ?? 'Erro desconhecido'),
        chave: null, protocolo: null, dhRecbto: null, emContingencia: false, xmls: [],
    };
}
