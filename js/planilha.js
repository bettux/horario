import { iniciarPagina } from './pagina.js';

// Tela reservada para a exportação da planilha (modelo confidencial da coordenação).
// O formato será montado a partir do modelo enviado pelo administrador.
const { main } = await iniciarPagina('planilha');

main.innerHTML = `
  <header class="cabecalho"><div>
    <h1>Criar planilha</h1>
    <p class="sub">Exportação do planejamento para Excel no modelo da coordenação. Uso restrito ao administrador.</p>
  </div></header>
  <div class="alerta alerta-aviso">Esta tela está em construção. O formato da planilha será montado a partir do modelo enviado pela coordenação.</div>`;
