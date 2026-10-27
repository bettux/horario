import { iniciarPagina, listarPeriodos, preencherPeriodos, mostrarErro } from './pagina.js';
import { rpc } from './supabase.js';
import { esc, parseData, ddmm, somaDias, isoData, segundaDaSemana, duracao } from './util.js';

const { main } = await iniciarPagina('carga');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Carga docente</h1>
    <p class="sub">Tudo em aulas equivalentes de 50 min. Limite: 40 por semana.</p></div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
      <div class="campo" style="width:140px"><label for="per">Período letivo</label><select id="per"></select></div>
      <div class="seg" role="group" aria-label="Modo de cálculo">
        <button type="button" class="sb" data-modo="semana">Semana específica</button>
        <button type="button" class="sb" data-modo="semestre">Semestre (pico semanal)</button>
      </div>
      <div class="campo" style="width:210px" id="box-sem"><label for="sem">Semana</label><select id="sem"></select></div>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="area"><p class="carregando">Carregando…</p></div>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
let modo = 'semana', dados = [], semana = 1, aberto = null;
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function marcar() {
  main.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('sb-on', b.dataset.modo === modo));
  $m('#box-sem').classList.toggle('oculto', modo !== 'semana');
}
main.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { modo = b.dataset.modo; marcar(); desenhar(); }));
marcar();

async function carregar() {
  if (!periodoId) { $m('#area').innerHTML = '<p class="muted">Crie um período em Configurações acadêmicas.</p>'; return; }
  try { dados = await rpc('carga_todos', { p_periodo: periodoId }); }
  catch (e) { mostrarErro($m('#msg'), e); return; }
  const semanas = [...new Map(dados.map((d) => [d.semana, d.segunda])).entries()].sort((a, b) => a[0] - b[0]);
  const hoje = isoData(segundaDaSemana(new Date()));
  $m('#sem').innerHTML = semanas.map(([n, seg]) => `<option value="${n}">Sem. ${n} · ${ddmm(parseData(seg))} a ${ddmm(somaDias(parseData(seg), 5))}</option>`).join('');
  semana = semanas.find(([, seg]) => seg === hoje)?.[0] || 1;
  $m('#sem').value = semana;
  aberto = null;
  desenhar();
}
$m('#sem').addEventListener('change', (e) => { semana = +e.target.value; desenhar(); });
$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });

function porProfessor() {
  const m = new Map();
  for (const d of dados) { if (!m.has(d.professor_id)) m.set(d.professor_id, { id: d.professor_id, nome: d.nome, ativo: d.ativo, semanas: [] }); m.get(d.professor_id).semanas.push(d); }
  return [...m.values()];
}

function desenhar() {
  const profs = porProfessor();
  if (!profs.length) { $m('#area').innerHTML = '<p class="muted">Nenhum professor ativo.</p>'; return; }
  if (modo === 'semana') {
    const linhas = profs.map((p) => ({ p, c: p.semanas.find((s) => s.semana === semana) })).filter((x) => x.c)
      .sort((a, b) => Number(b.c.total) - Number(a.c.total) || a.p.nome.localeCompare(b.p.nome));
    if (!aberto && linhas.length) aberto = linhas[0].p.id;
    const sel = linhas.find((x) => x.p.id === aberto) || linhas[0];
    $m('#area').innerHTML = `<div class="duas-colunas">
      <section class="card larga tabela-box"><table style="min-width:760px">
        <thead><tr><th>Professor</th><th style="text-align:right">Graduação<br><span style="font-weight:500">aulas 50 min</span></th><th style="text-align:right">Aulas pós<br><span style="font-weight:500">equiv. 50 min</span></th>
          <th style="text-align:right">Preparação</th><th style="text-align:right">Atividades<br><span style="font-weight:500">semanais</span></th><th style="text-align:right">Total semanal</th><th>Detalhes</th></tr></thead>
        <tbody>${linhas.map(({ p, c }) => `<tr class="${p.ativo ? '' : 'inativo'}"${p.id === sel?.p.id ? ' style="background:#FFF8F9"' : ''}>
          <td>${esc(p.nome)}${p.ativo ? '' : ' <span class="chip chip-neu">inativo</span>'}</td>
          <td class="num" style="text-align:right">${num(c.graduacao)}</td>
          <td class="num" style="text-align:right">${c.pos50}${c.pos_minutos ? `<br><span class="muted" style="font-size:11.5px">${duracao(c.pos_minutos)}</span>` : ''}</td>
          <td class="num" style="text-align:right">${num(c.preparacao)}</td>
          <td class="num" style="text-align:right">${num(c.atividades)}</td>
          <td class="num" style="text-align:right"><strong style="font-size:14.5px">${num(c.total)}</strong> / 40 ${Number(c.total) > 40 ? '<span class="chip chip-erro">acima</span>' : Number(c.total) === 40 ? '<span class="chip chip-aviso">no limite</span>' : ''}</td>
          <td>${p.id === sel?.p.id ? '<span style="font-size:13px;font-weight:600;color:var(--vermelho-escuro)">Aberto ao lado</span>' : `<button class="btn btn-s" data-ver="${p.id}">Ver cálculo</button>`}</td></tr>`).join('')}</tbody></table></section>
      <aside class="card estreita painel" id="detalhe">${sel ? detalhe(sel.p, sel.c) : ''}</aside></div>`;
    main.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => { aberto = b.dataset.ver; desenhar(); }));
  } else {
    const linhas = profs.map((p) => {
      const pico = Math.max(...p.semanas.map((s) => Number(s.total)));
      const picos = p.semanas.filter((s) => Number(s.total) === pico).map((s) => s.semana);
      return { p, pico, picos };
    }).sort((a, b) => b.pico - a.pico || a.p.nome.localeCompare(b.p.nome));
    $m('#area').innerHTML = `<section class="card tabela-box"><table style="min-width:760px">
      <thead><tr><th>Professor</th><th style="text-align:right">Pico semanal</th><th>Semana(s) do pico</th><th style="width:45%">Total de cada semana</th></tr></thead>
      <tbody>${linhas.map(({ p, pico, picos }) => `<tr class="${p.ativo ? '' : 'inativo'}">
        <td>${esc(p.nome)}</td>
        <td class="num" style="text-align:right"><strong style="font-size:14.5px">${num(pico)}</strong> / 40 ${pico > 40 ? '<span class="chip chip-erro">acima</span>' : ''}</td>
        <td class="num muted" style="font-size:12.5px">${picos.length > 6 ? `${picos.length} semanas` : 'Sem. ' + picos.join(', ')}</td>
        <td><div style="display:flex;align-items:flex-end;gap:3px;height:40px" role="img" aria-label="Totais semanais de ${esc(p.nome)}: ${p.semanas.map((s) => num(s.total)).join(', ')}">
          ${p.semanas.map((s) => `<span title="Sem. ${s.semana}: ${num(s.total)}" style="flex:1 1 0;min-width:5px;border-radius:2px;height:${Math.max(2, Math.min(40, (Number(s.total) / 40) * 40))}px;background:${Number(s.total) === pico && pico > 0 ? 'var(--vermelho)' : '#C9C9D1'}"></span>`).join('')}
        </div></td></tr>`).join('')}</tbody></table></section>
      <p class="muted" style="margin:0;font-size:13px;line-height:1.5">O pico é a semana de maior total, calculada semana a semana com as datas reais da pós e os feriados. Nunca é a soma do semestre. Barras em vermelho marcam as semanas de pico.</p>`;
  }
}

function detalhe(p, c) {
  const l = (a, b, forte) => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:8px 0;border-bottom:1px solid #F0F0F3${forte ? ';font-size:14px' : ''}"><span>${a}</span><span class="num" style="font-weight:600;text-align:right">${b}</span></div>`;
  const g = Number(c.graduacao), p50 = c.pos50;
  return `<h2>${esc(p.nome.split(' ')[0])} · semana ${c.semana} (${ddmm(parseData(c.segunda))})</h2>
    ${l('Graduação', `${num(g)} aulas`)}
    ${c.pos_minutos ? l(`Pós: ${duracao(c.pos_minutos)} = ${c.pos_minutos} min ÷ 50`, `${num(c.pos_minutos / 50)} → ${p50}`) : l('Pós', '0')}
    ${l('Preparação: 20% da graduação + 10% da pós, cada um arredondado para cima', `+ ${num(c.preparacao)}`)}
    ${l('Ensino com preparação', c.ensino)}
    ${l('Atividades semanais (sem preparação)', `+ ${num(c.atividades)}`)}
    ${l('<strong>Total semanal</strong>', `${num(c.total)} de 40`, true)}
    <p class="muted" style="margin:6px 0 0;font-size:12.5px;line-height:1.5">Igual à planilha da coordenação: os 20% e os 10% são arredondados para cima separadamente. Aulas de Extensão contam sem preparação. Atividades "do período" não entram no total semanal.</p>`;
}

carregar();
