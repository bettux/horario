import { exigirSessao } from './auth.js?v=202611221335';
import { montarLayout } from './layout.js?v=202611221335';
import { rpc } from './supabase.js?v=202611221335';
import { esc, DIAS, isoData, parseData, ddmm, ddmmaaaa, duracao, mostrarAlerta } from './util.js?v=202611221335';
import { carregarDiasLetivos, abrirDiasLetivos } from './dias-letivos.js?v=202611221335';
import { abrirCalendario } from './calendario.js?v=202611221335';

// Visão do professor: só o período (sem navegar por semana)
const perfil = await exigirSessao();
const main = montarLayout(perfil, 'minhas');

main.innerHTML = `
  <header class="cabecalho">
    <div>
      <h1>Minhas aulas</h1>
      <p class="sub">Somente as suas aulas. Para alterar algo, fale com a coordenação.</p>
    </div>
    <div class="campo" style="width:150px"><label for="per">Período letivo</label><select id="per"></select></div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const sel = main.querySelector('#per');
const conteudo = main.querySelector('#conteudo');
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
let periodos = [];

try { periodos = await rpc('meus_periodos'); }
catch (e) { mostrarAlerta(main.querySelector('#msg'), 'erro', e.message); }

if (!periodos.length) {
  conteudo.innerHTML = '<div class="card" style="padding:24px"><p style="margin:0">Nenhum período liberado para consulta no momento.</p></div>';
  sel.disabled = true;
} else {
  sel.innerHTML = periodos.map((p) => `<option value="${p.id}">${p.ano}/${p.semestre}${perfil.perfil === 'adm' && !p.visivel_professor ? ' (oculto)' : ''}</option>`).join('');
  const hoje = isoData(new Date());
  const atual = periodos.find((p) => p.inicio <= hoje && hoje <= p.fim) || periodos.find((p) => p.visivel_professor) || periodos[0];
  sel.value = atual.id;
  sel.addEventListener('change', () => carregar(sel.value));
  carregar(atual.id);
}

async function carregar(id) {
  const periodo = periodos.find((p) => p.id === id);
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    const [dados, dias] = await Promise.all([rpc('minhas_aulas', { p_periodo: id }), carregarDiasLetivos(id).catch(() => [])]);
    desenhar(periodo, dados, dias);
  } catch (e) { conteudo.innerHTML = ''; mostrarAlerta(main.querySelector('#msg'), 'erro', e.message); }
}

function desenhar(periodo, dados, dias) {
  // carga: a semana mais cheia do período
  const pico = (dados.carga || []).reduce((m, c) => (Number(c.total) > Number(m?.total ?? -1) ? c : m), null);
  const kpis = pico ? `
    <section class="kpis" aria-label="Carga semanal">
      <div class="card kpi"><span class="kl">Graduação</span><span class="kv num">${num(pico.graduacao)}</span><span class="kd">aulas de 50 min</span></div>
      <div class="card kpi"><span class="kl">Aulas pós</span><span class="kv num">${pico.pos50}</span><span class="kd">equiv. 50 min</span></div>
      <div class="card kpi"><span class="kl">Preparação</span><span class="kv num">${num(pico.preparacao)}</span><span class="kd">aulas equivalentes</span></div>
      <div class="card kpi"><span class="kl">Atividades complementares</span><span class="kv num">${num(pico.atividades)}</span><span class="kd">por semana</span></div>
      <div class="card kpi" style="border-color:#F2C4CB;background:#FFF8F9"><span class="kl" style="color:var(--vermelho-escuro)">Total semanal</span><span class="kv num">${num(pico.total)} <span style="font-size:15px;font-weight:600;color:var(--texto-suave)">/ 40</span></span><span class="kd">semana mais cheia do período</span></div>
    </section>` : '';

  // grade fixa da semana (graduação) + dias de pós
  const posPorDia = {};
  for (const e of dados.pos) { const d = ((parseData(e.data).getDay() + 6) % 7) + 1; (posPorDia[d] ||= []).push(e); }
  const diasGrade = [1, 2, 3, 4, 5, 6].filter((d) => d <= 5 || dados.graduacao.some((a) => a.dia_semana === 6) || posPorDia[6]);
  const grade = `<section class="semana">${diasGrade.map((d) => {
    const aulas = dados.graduacao.filter((a) => a.dia_semana === d).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const pos = posPorDia[d] || [];
    return `<div class="card dia">
      <div class="dia-cab"><strong>${DIAS[d]}</strong></div>
      ${pos.length ? `<span class="chip chip-red" style="align-self:flex-start">Pós em ${pos.length} ${pos.length === 1 ? 'data' : 'datas'}</span>` : ''}
      ${aulas.map((a) => `<div class="aula">
          <span class="t num">${esc(a.inicio)} – ${esc(a.fim)} · ${a.quantidade} aula${a.quantidade > 1 ? 's' : ''}</span>
          <span class="n">${esc(a.componente)}</span>
          <span class="d">${esc(a.turma)}${a.subturmas ? ' · ' + esc(a.subturmas) : ''}</span>
          ${a.ambiente ? `<span class="d">${esc(a.ambiente)}</span>` : ''}</div>`).join('') || (pos.length ? '' : '<p class="vazio">Sem aulas</p>')}
    </div>`;
  }).join('')}</section>`;

  // encontros de pós (todos do período)
  const tabelaPos = dados.pos.length ? `
    <section class="card" style="overflow:hidden">
      <div style="padding:16px 18px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline">
        <h2 style="font-size:15px">Encontros da pós-graduação</h2>
        <span class="muted" style="font-size:13px">As datas já descontam feriados e dias não letivos</span></div>
      <div class="tabela-box"><table>
        <thead><tr><th>Data</th><th>Turma</th><th>Módulo</th><th>Horário</th><th>Ambiente</th><th>Encontro</th></tr></thead>
        <tbody>${dados.pos.map((e) => { const dt = parseData(e.data);
          return `<tr><td class="num">${DIAS[((dt.getDay() + 6) % 7) + 1].slice(0, 3)} ${ddmmaaaa(dt)}</td><td>${esc(e.turma)}</td><td>${esc(e.componente)}</td>
            <td class="num">${esc(e.inicio)} – ${esc(e.fim)} · ${duracao(e.minutos)}</td><td>${esc(e.ambiente || '—')}</td><td class="num">${e.numero} de ${e.total}</td></tr>`; }).join('')}</tbody>
      </table></div></section>` : '';

  // reposições que afetam este professor (dias da semana em que ele tem graduação)
  const meusDias = new Set(dados.graduacao.map((a) => a.dia_semana));
  const reps = dias.filter((l) => (l.reposicao_de || l.tipo === 'compensacao') && meusDias.has(l.dia_semana));
  const reposicoes = reps.length ? `
    <section class="card reposicoes"><strong>Sábados letivos do período</strong>
      ${reps.map((l) => (l.tipo === 'compensacao'
        ? `<span>No <strong>sábado ${ddmm(parseData(l.data))}</strong> haverá as aulas de ${DIAS[l.dia_semana].toLowerCase()} (compensação do calendário${l.motivo ? `: ${esc(l.motivo)}` : ''}).</span>`
        : `<span>As aulas de ${DIAS[l.dia_semana].toLowerCase()} ${ddmm(parseData(l.reposicao_de))}${l.motivo ? ` (${esc(l.motivo)})` : ''} serão repostas no <strong>sábado ${ddmm(parseData(l.data))}</strong>.</span>`)).join('')}
    </section>` : '';

  const ativ = dados.atividades || [];
  const atividades = ativ.length ? `
    <section class="card" style="padding:14px 18px;display:flex;flex-wrap:wrap;gap:8px 24px;font-size:13.5px;align-items:baseline">
      <strong>Atividades complementares</strong>
      ${ativ.map((a) => `<span>${esc(a.descricao)} · ${num(a.quantidade)} ${a.frequencia === 'semanal' ? 'por semana' : 'no período'}</span>`).join('')}
    </section>` : '';

  const semAulas = !dados.graduacao.length && !dados.pos.length
    ? '<div class="card" style="padding:18px"><p style="margin:0">Você não tem aulas atribuídas neste período.</p></div>' : '';

  conteudo.innerHTML = `<div style="display:flex;flex-direction:column;gap:20px">
    ${kpis}${semAulas}${dados.graduacao.length || dados.pos.length ? grade : ''}${reposicoes}${atividades}${tabelaPos}
    <div class="acoes-rodape">
      <button class="btn" type="button" id="btn-cal">${periodo.tem_calendario ? 'Calendário escolar' : 'Calendário ainda não publicado'}</button>
      <button class="btn" type="button" id="btn-dias">Dias letivos</button>
    </div></div>`;
  const btnCal = conteudo.querySelector('#btn-cal');
  if (!periodo.tem_calendario) btnCal.disabled = true;
  btnCal.addEventListener('click', async () => {
    try { await abrirCalendario(periodo.id); } catch (e) { mostrarAlerta(main.querySelector('#msg'), 'erro', e.message); }
  });
  conteudo.querySelector('#btn-dias').addEventListener('click', () => abrirDiasLetivos(periodo));
}
