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
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import type { gIBSCBSMono } from '@nfewizard/types/nfe';

// NT 2025.002 v1.50: os tipos do grupo monofásico seguem o schema `TMonofasia` (DFeTiposBasicos).

describe('gIBSCBSMono segue o schema da NT 2025.002 v1.50', () => {
    it('aceita IBS ad valorem + CBS ad valorem e IBS ad rem + CBS ad rem', () => {
        const adValorem: gIBSCBSMono = {
            gIBSMonoAdValorem: { gMonoPadrao: { vBCMono: '100.00', pAliqMonoUF: '0.1000', vIBSMonoUF: '0.10', pAliqMonoMun: '0.0000', vIBSMonoMun: '0.00', vIBSMono: '0.10' } },
            gCBSMonoAdValorem: { gMonoPadrao: { vBCMono: '100.00', pAliqMonoCBS: '0.9000', vCBSMono: '0.90' } },
            vTotIBSMonoItem: '0.10',
            vTotCBSMonoItem: '0.90',
        };
        const adRem: gIBSCBSMono = {
            gIBSMonoAdRem: { gMonoPadrao: { qBCMono: '10.0000', adRemIBS: '0.0100', vIBSMono: '0.10' } },
            gCBSMonoAdRem: { gMonoRet: { vCBSMonoRet: '0.50' } },
            vTotIBSMonoItem: '0.10',
            vTotCBSMonoItem: '0.00',
        };
        expect(Object.keys(adValorem)).toEqual(['gIBSMonoAdValorem', 'gCBSMonoAdValorem', 'vTotIBSMonoItem', 'vTotCBSMonoItem']);
        expect(adRem.gIBSMonoAdRem?.gMonoPadrao?.adRemIBS).toBe('0.0100');
    });

    it('o compilador recusa IBS ad rem junto com ad valorem (xs:choice) e o gMonoDif antigo', () => {
        // checagem com o tsc de verdade, usando o tsconfig do pacote (o ts-jest daqui não resolve o caminho @nfewizard/types/nfe)
        const raiz = path.resolve(__dirname, '../../../../..');
        const arquivo = path.join(__dirname, `_monofasia_${process.pid}.ts`);
        fs.writeFileSync(arquivo, [
            "import type { gIBSCBSMono } from '@nfewizard/types/nfe';",
            "export const ok: gIBSCBSMono = { gIBSMonoAdRem: { gMonoRet: { vIBSMonoRet: '1' } }, gCBSMonoAdValorem: { gMonoRet: { vCBSMonoRet: '1' } }, vTotIBSMonoItem: '0', vTotCBSMonoItem: '0' };",
            "export const dois: gIBSCBSMono = { gIBSMonoAdRem: { gMonoRet: { vIBSMonoRet: '1' } }, gIBSMonoAdValorem: { gMonoRet: { vIBSMonoRet: '1' } }, vTotIBSMonoItem: '0', vTotCBSMonoItem: '0' };",
            "export const antigo: gIBSCBSMono = { gMonoDif: {}, vTotIBSMonoItem: '0', vTotCBSMonoItem: '0' };",
        ].join('\n'));
        try {
            const cfgPath = path.join(raiz, 'tsconfig.json');
            const lido = ts.readConfigFile(cfgPath, ts.sys.readFile);
            const cfg = ts.parseJsonConfigFileContent(lido.config, ts.sys, raiz);
            const programa = ts.createProgram([arquivo], { ...cfg.options, noEmit: true });
            const erros = ts.getPreEmitDiagnostics(programa).filter((d) => d.file?.fileName === arquivo);
            const linhas = erros.map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line + 1);
            expect(linhas).not.toContain(2); // o válido compila
            expect(linhas).toContain(3);     // ad rem + ad valorem
            expect(linhas).toContain(4);     // gMonoDif
        } finally {
            fs.unlinkSync(arquivo);
        }
    }, 60000);

    it('o schema tem exatamente esses grupos no TMonofasia (e não o gMonoDif antigo)', () => {
        const xsd = fs.readFileSync(path.resolve(__dirname, '../../../../../../shared/resources/schemas/DFeTiposBasicos_v1.00.xsd'), 'utf8');
        const ini = xsd.indexOf('<xs:complexType name="TMonofasia">');
        const trecho = xsd.slice(ini, xsd.indexOf('</xs:complexType>', xsd.indexOf('name="vTotCBSMonoItem"', ini)));
        for (const g of ['gIBSMonoAdRem', 'gIBSMonoAdValorem', 'gCBSMonoAdRem', 'gCBSMonoAdValorem', 'gpBioDiferenca', 'vTotIBSMonoItem', 'vTotCBSMonoItem']) {
            expect(trecho).toContain(`name="${g}"`);
        }
        expect(trecho).not.toContain('name="gMonoDif"');
    });
});
