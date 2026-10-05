# Assets da marca Vortrix AI

Versão **provisória** (monograma geométrico V + X). Para aplicar o logo definitivo, substitua os arquivos mantendo os nomes:

| Arquivo | Uso |
|---|---|
| `vortrix-mark.svg` | Símbolo isolado (quadrado, 32×32) |
| `vortrix-logo-light.svg` | Logo horizontal para fundos claros |
| `vortrix-logo-dark.svg` | Logo horizontal para fundos escuros (sidebar) |
| `../../src/app/icon.svg` | Favicon (Next.js usa automaticamente) |

Na interface, o logo vem de `src/components/logo.tsx` (`<VortrixMark>` e `<Logo>`), em SVG inline com os tokens da
marca. Ao trocar o símbolo, atualize também esse componente. O texto dos SVGs horizontais depende da fonte instalada;
o definitivo deve vir com o texto convertido em curvas.
