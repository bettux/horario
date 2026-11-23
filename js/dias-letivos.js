// Dias letivos do período (seg a sex), com os sábados de reposição no lugar dos dias não letivos
import { rpc } from './supabase.js?v=202611222334';
import { esc, DIAS, parseData, ddmm, ddmmaaaa } from './util.js?v=202611222334';

export async function carregarDiasLetivos(periodoId) {
  return await rpc('dias_letivos', { p_periodo: periodoId });
}

// contagem por dia da semana: { 1: 19, 2: 20, ... }
export function contarPorDia(linhas) {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const l of linhas) c[l.dia_semana] = (c[l.dia_semana] || 0) + 1;
  return c;
}

export function htmlDiasLetivos(linhas, periodo) {
  const cols = [1, 2, 3, 4, 5].map((d) => linhas.filter((l) => l.dia_semana === d).sort((a, b) => a.data.localeCompare(b.data)));
  const max = Math.max(0, ...cols.map((c) => c.length));
  const celula = (l) => {
    if (!l) return '<td></td>';
    if (l.tipo === 'compensacao') return `<td class="dl-comp"><span class="num"><strong>${ddmm(parseData(l.data))}</strong> sáb.</span><span>compensação</span></td>`;
    if (!l.reposicao_de) return `<td class="num">${ddmm(parseData(l.data))}</td>`;
    return `<td class="dl-rep"><span class="num"><strong>${ddmm(parseData(l.data))}</strong> sáb.</span><span>reposição de ${ddmm(parseData(l.reposicao_de))}</span></td>`;
  };
  return `
    <div class="dl-cab"><strong>Dias letivos · ${periodo.ano}/${periodo.semestre}</strong>
      <span class="muted">${ddmmaaaa(parseData(periodo.inicio))} a ${ddmmaaaa(parseData(periodo.fim))} · graduação</span></div>
    <div class="tabela-box"><table class="dl-tabela">
      <thead><tr>${[1, 2, 3, 4, 5].map((d) => `<th>${DIAS[d]}</th>`).join('')}</tr></thead>
      <tbody>${Array.from({ length: max }, (_, i) => `<tr>${cols.map((c) => celula(c[i])).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr>${cols.map((c) => `<td><strong>${c.length}</strong> ${c.length === 1 ? "dia" : "dias"}</td>`).join('')}</tr></tfoot>
    </table></div>
    <p class="muted" style="margin:0;font-size:12px">Sábados em rosa repõem um dia sem aula; em azul, são sábados de compensação do calendário, com as aulas do dia da coluna.</p>`;
}

// janela com a tabela e o botão de imprimir
export async function abrirDiasLetivos(periodo) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo dl-dialogo';
  dlg.innerHTML = '<div class="dialogo-form"><p class="carregando">Carregando…</p></div>';
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); document.body.classList.remove('imprimindo-dl'); });
  dlg.showModal();
  try {
    const linhas = await carregarDiasLetivos(periodo.id);
    dlg.firstChild.innerHTML = `${htmlDiasLetivos(linhas, periodo)}
      <div class="dialogo-acoes so-tela"><button type="button" class="btn" data-fechar>Fechar</button><button type="button" class="btn btn-p" data-imprimir>Imprimir</button></div>`;
  } catch (e) {
    dlg.firstChild.innerHTML = `<div class="alerta alerta-erro">${esc(e.message)}</div><div class="dialogo-acoes"><button type="button" class="btn" data-fechar>Fechar</button></div>`;
  }
  dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-imprimir]')?.addEventListener('click', () => { document.body.classList.add('imprimindo-dl'); window.print(); document.body.classList.remove('imprimindo-dl'); });
}
