# Assets da marca Vortrix AI

Versão **aproximada** do símbolo do guia de marca (monograma V + X em faixas com degradê índigo → violeta), redesenhada em SVG a partir de uma referência raster. Para aplicar o logo definitivo, substitua os arquivos mantendo os nomes:

| Arquivo | Uso |
|---|---|
| `vortrix-mark.svg` | Símbolo isolado (64×64, fundo transparente) |
| `vortrix-app-icon.svg` | Ícone de app: símbolo sobre quadrado midnight `#0A0F1E` |
| `vortrix-logo-light.svg` | Logo horizontal para fundos claros |
| `vortrix-logo-dark.svg` | Logo horizontal para fundos escuros (sidebar) |
| `../../src/app/icon.svg` | Favicon (cópia do ícone de app; o Next.js usa automaticamente) |

Na interface, o logo vem de `src/components/logo.tsx` (`<VortrixMark>` e `<Logo>`), em SVG inline com a mesma
geometria (viewBox 64×64). Ao trocar o símbolo, atualize também esse componente. Degradê só no símbolo e no login
(`src/components/brand-backdrop.tsx`). O texto dos SVGs horizontais depende da fonte instalada; o definitivo deve vir com o texto convertido em curvas.
