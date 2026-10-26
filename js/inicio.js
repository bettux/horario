import { iniciarPagina, listarPeriodos, preencherPeriodos, mostrarErro } from './pagina.js';
import { rpc } from './supabase.js';
import { esc, isoData, segundaDaSemana, parseData, ddmm, duracao } from './util.js';
import { carregarAnalise } from './analise.js';

const { perfil, main } = await iniciarPagina('inicio');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Dashboard</h1>
    <p class="sub">Situação do planejamento no período letivo selecionado.</p></div>
    <div class="campo" style="width:160px"><label for="per">Período letivo</label><select id="per"></select></div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="area"><p class="carregando">Carregando…</p></div>`;

const $m = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($m('#per'), periodos);
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

async function carregar() {
  if (!periodoId) {
    $m('#area').innerHTML = `<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:10px">
      <strong>Bem-vindo, ${esc(perfil.nome.split(' ')[0])}.</strong>
      <span>Para começar, crie o período letivo em <a href="configuracoes.html">Configurações acadêmicas</a>, depois as turmas e os professores.</span></div>`;
    return;
  }
  const periodo = periodos.find((p) => p.id === periodoId);
  $m('#area').innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    const [an, carga, erros] = await Promise.all([carregarAnalise(periodo), rpc('carga_todos', { p_periodo: periodoId }), rpc('auditoria', { p_periodo: periodoId })]);
    desenhar(periodo, an, carga, erros);
  } catch (e) { mostrarErro($m('#msg'), e); }
}

function desenhar(periodo, an, carga, erros) {
  // carga por professor
  const profs = new Map();
  for (const c of carga) { if (!profs.has(c.professor_id)) profs.set(c.professor_id, { id: c.professor_id, nome: c.nome, ativo: c.ativo, semanas: [] }); profs.get(c.professor_id).semanas.push(c); }
  const lista = [...profs.values()];
  const alocados = lista.filter((p) => p.semanas.some((s) => Number(s.graduacao) > 0 || s.pos_minutos > 0));
  const ativos = lista.filter((p) => p.ativo);
  const hoje = isoData(segundaDaSemana(new Date()));
  const semRef = carga.find((c) => c.segunda === hoje)?.semana || 1;
  const segRef = carga.find((c) => c.semana === semRef)?.segunda;

  const grad = an.turmas.filter((t) => !t.pos), pos = an.turmas.filter((t) => t.pos);
  const sg = grad.map((t) => ({ t, s: an.situacaoGrad(t) }));
  const sp = pos.map((t) => ({ t, s: an.situacaoPos(t) }));
  const compTot = sg.reduce((n, x) => n + x.s.total, 0), compOk = sg.reduce((n, x) => n + x.s.completos, 0);
  const nAvisos = sg.reduce((n, x) => n + x.s.avisos.length + (x.s.aulas ? 0 : 1), 0) + sp.reduce((n, x) => n + x.s.avisos.length + (x.s.ofertas ? 0 : 1), 0) + an.ambParecidos.length;
  const encTot = sp.reduce((n, x) => n + x.s.encontros, 0), ofTot = sp.reduce((n, x) => n + x.s.ofertas, 0);

  const linhasProf = lista.map((p) => {
    const c = p.semanas.find((s) => s.semana === semRef) || p.semanas[0];
    const pico = Math.max(...p.semanas.map((s) => Number(s.total)));
    return { p, c, pico };
  }).sort((a, b) => Number(b.c.total) - Number(a.c.total) || a.p.nome.localeCompare(b.p.nome));

  $m('#area').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px">
    <section class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      <div class="card kpi"><span class="kl">Professores alocados</span><span class="kv num">${alocados.length} <span style="font-size:16px;font-weight:600;color:var(--texto-suave)">de ${ativos.length} ativos</span></span><span class="kd">${ativos.length - alocados.filter((p) => p.ativo).length} ativo(s) ainda sem aula</span></div>
      <div class="card kpi"><span class="kl">Turmas no período</span><span class="kv num">${an.turmas.length}</span><span class="kd">${grad.length} de graduação · ${pos.length} de pós</span></div>
      <div class="card kpi"><span class="kl">Componentes completos</span><span class="kv num">${compOk} <span style="font-size:16px;font-weight:600;color:var(--texto-suave)">de ${compTot}</span></span><span class="kd">Graduação, comparado à carga da matriz</span></div>
      <div class="card kpi"><span class="kl">Encontros de pós</span><span class="kv num">${encTot}</span><span class="kd">${ofTot} módulo(s) planejado(s)</span></div>
      <a class="card kpi" href="auditoria.html" style="text-decoration:none;color:var(--texto)"><span class="kl">Pendências</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap;padding:6px 0 2px"><span class="chip chip-erro">${erros.length} erro${erros.length === 1 ? '' : 's'}</span><span class="chip chip-aviso">${nAvisos} aviso${nAvisos === 1 ? '' : 's'}</span></span>
        <span class="kd" style="color:var(--vermelho-escuro);font-weight:600">Abrir auditoria</span></a>
    </section>

    <div class="duas-colunas">
      <section class="card larga" style="overflow:hidden">
        <div class="barra" style="justify-content:space-between;align-items:baseline"><h2 style="font-size:15px">Andamento por turma</h2><a href="grade.html" style="font-size:13px;font-weight:600">Abrir grade</a></div>
        <div class="tabela-box"><table>
          <thead><tr><th>Turma</th><th>Componentes completos</th><th style="width:30%">Progresso</th><th>Situação</th></tr></thead>
          <tbody>${sg.length ? sg.map(({ t, s }) => {
            const pct = s.total ? Math.round((s.completos / s.total) * 100) : 0;
            const sit = !s.aulas ? '<span class="chip chip-aviso">Não iniciada</span>' : s.completos === s.total ? '<span class="chip chip-ok">Completa</span>' : '<span class="chip chip-neu">Em andamento</span>';
            return `<tr><td><a href="grade.html?turma=${t.id}" style="color:var(--texto);text-decoration:none">${esc(t.rotulo)}</a></td><td class="num">${s.completos} de ${s.total}</td>
              <td><div style="height:6px;border-radius:999px;background:#EEEEF1;overflow:hidden"><div style="height:6px;border-radius:999px;width:${pct}%;background:${pct === 100 ? '#1F8A4C' : 'var(--vermelho)'}"></div></div></td><td>${sit}</td></tr>`;
          }).join('') : '<tr><td colspan="4" class="muted">Nenhuma turma de graduação neste período.</td></tr>'}</tbody></table></div>
      </section>
      <section class="card estreita" style="overflow:hidden">
        <div class="barra" style="justify-content:space-between;align-items:baseline"><h2 style="font-size:15px">Pós-graduação no período</h2><a href="pos.html" style="font-size:13px;font-weight:600">Abrir planejamento</a></div>
        <div class="tabela-box"><table>
          <thead><tr><th>Turma</th><th>Módulos</th><th>Modo</th></tr></thead>
          <tbody>${sp.length ? sp.map(({ t, s }) => `<tr><td>${esc(t.rotulo)}</td><td class="num">${s.completos} de ${s.ofertas} completos</td><td>${s.modos.map((m) => (m === 'semana' ? 'Semana' : 'Sábado')).join(' e ') || '—'}</td></tr>`).join('')
            : '<tr><td colspan="3" class="muted">Nenhuma turma de pós neste período.</td></tr>'}</tbody></table></div>
      </section>
    </div>

    <section class="card" style="overflow:hidden">
      <div class="barra" style="justify-content:space-between;align-items:baseline">
        <div><h2 style="font-size:15px">Aulas de todos os professores</h2>
        <p class="muted" style="margin:4px 0 0;font-size:12.5px">Semana ${semRef}${segRef ? ` (${ddmm(parseData(segRef))})` : ''} · aulas equivalentes de 50 min</p></div>
        <a href="carga.html" style="font-size:13px;font-weight:600">Ver carga docente</a>
      </div>
      <div class="tabela-box"><table style="min-width:760px">
        <thead><tr><th>Professor</th><th style="text-align:right">Graduação</th><th style="text-align:right">Pós</th><th style="text-align:right">Preparação</th><th style="text-align:right">Atividades</th><th style="text-align:right">Total semanal</th><th style="width:20%">Uso do limite de 40</th><th style="text-align:right">Pico no semestre</th></tr></thead>
        <tbody>${linhasProf.map(({ p, c, pico }) => `<tr class="${p.ativo ? '' : 'inativo'}">
          <td><a href="agenda.html?professor=${p.id}" style="color:inherit;text-decoration:none">${esc(p.nome)}</a>${p.ativo ? '' : ' <span class="chip chip-neu">inativo</span>'}</td>
          <td class="num" style="text-align:right">${num(c.graduacao)}</td>
          <td class="num" style="text-align:right">${c.pos50}${c.pos_minutos ? ` <span class="muted" style="font-size:11.5px">(${duracao(c.pos_minutos)})</span>` : ''}</td>
          <td class="num" style="text-align:right">${num(c.preparacao)}</td><td class="num" style="text-align:right">${num(c.atividades)}</td>
          <td class="num" style="text-align:right"><strong>${num(c.total)}</strong></td>
          <td><div style="height:6px;border-radius:999px;background:#EEEEF1;overflow:hidden"><div style="height:6px;border-radius:999px;width:${Math.min(100, (Number(c.total) / 40) * 100)}%;background:${Number(c.total) > 40 ? '#C2410C' : 'var(--vermelho)'}"></div></div></td>
          <td class="num" style="text-align:right">${pico > 0 ? num(pico) : '<span class="muted">sem aulas</span>'}${pico >= 40 ? ' <span class="chip chip-aviso">no limite</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
    </section>
    </div>`;
}

$m('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });
carregar();
