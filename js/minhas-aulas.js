import { exigirSessao } from './auth.js';
import { montarLayout } from './layout.js';
import { rpc } from './supabase.js';
import { esc, DIAS, parseData, isoData, somaDias, segundaDaSemana, ddmm, ddmmaaaa, duracao, mostrarAlerta } from './util.js';

const perfil = await exigirSessao();
const main = montarLayout(perfil, 'minhas');

main.innerHTML = `
  <header class="cabecalho">
    <div>
      <h1>Minhas aulas</h1>
      <p class="sub">Somente as suas aulas. Para alterar algo, fale com a coordenação.</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <div class="campo" style="width:140px"><label for="per">Período letivo</label><select id="per"></select></div>
      <button class="btn" type="button" id="ant" aria-label="Semana anterior">‹</button>
      <div class="num" id="rotulo-semana" style="min-height:38px;display:flex;align-items:center;padding:0 14px;border-radius:8px;background:#fff;border:1px solid var(--borda-forte);font-weight:600"></div>
      <button class="btn" type="button" id="prox" aria-label="Próxima semana">›</button>
      <button class="btn" type="button" id="hoje">Esta semana</button>
    </div>
  </header>
  <div id="msg" class="oculto" role="alert"></div>
  <div id="conteudo"><p class="carregando">Carregando…</p></div>`;

const sel = main.querySelector('#per');
const conteudo = main.querySelector('#conteudo');
let periodos = [];
let dados = null;     // resposta de minhas_aulas
let periodo = null;   // período selecionado
let segunda = null;   // segunda-feira da semana exibida

try {
  periodos = await rpc('meus_periodos');
} catch (e) {
  mostrarAlerta(main.querySelector('#msg'), 'erro', e.message);
}

if (!periodos.length) {
  conteudo.innerHTML = '<div class="card" style="padding:24px"><p style="margin:0">Você ainda não tem aulas atribuídas em nenhum período.</p></div>';
  main.querySelectorAll('header button, header select').forEach((b) => (b.disabled = true));
} else {
  sel.innerHTML = periodos.map((p) => `<option value="${p.id}">${p.ano}/${p.semestre}</option>`).join('');
  // escolhe o período que contém hoje, senão o mais recente
  const hoje = isoData(new Date());
  const atual = periodos.find((p) => p.inicio <= hoje && hoje <= p.fim) || periodos[0];
  sel.value = atual.id;
  await carregarPeriodo(atual.id, true);
  sel.addEventListener('change', () => carregarPeriodo(sel.value, true));
  main.querySelector('#ant').addEventListener('click', () => mudarSemana(-7));
  main.querySelector('#prox').addEventListener('click', () => mudarSemana(7));
  main.querySelector('#hoje').addEventListener('click', () => { segunda = limitar(segundaDaSemana(new Date())); desenhar(); });
}

async function carregarPeriodo(id, irParaHoje) {
  periodo = periodos.find((p) => p.id === id);
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    dados = await rpc('minhas_aulas', { p_periodo: id });
  } catch (e) {
    mostrarAlerta(main.querySelector('#msg'), 'erro', e.message);
    return;
  }
  if (irParaHoje) segunda = limitar(segundaDaSemana(new Date()));
  desenhar();
}

function limitar(seg) {
  const ini = segundaDaSemana(parseData(periodo.inicio));
  const fim = segundaDaSemana(parseData(periodo.fim));
  if (seg < ini) return ini;
  if (seg > fim) return fim;
  return seg;
}
function mudarSemana(n) { segunda = limitar(somaDias(segunda, n)); desenhar(); }

function desenhar() {
  const sabado = somaDias(segunda, 5);
  main.querySelector('#rotulo-semana').textContent = `${ddmm(segunda)} a ${ddmmaaaa(sabado)}`;
  const iniPer = parseData(periodo.inicio), fimPer = parseData(periodo.fim);

  const dias = [1, 2, 3, 4, 5, 6].map((d) => {
    const data = somaDias(segunda, d - 1);
    const dentro = data >= iniPer && data <= fimPer;
    const iso = isoData(data);
    const grad = dentro ? dados.graduacao.filter((a) => a.dia_semana === d) : [];
    const pos = dados.pos.filter((e) => e.data === iso);
    const itens = [
      ...pos.map((e) => `
        <div class="aula aula-pos">
          <span class="t num">${esc(e.inicio)} – ${esc(e.fim)} · ${duracao(e.minutos)}</span>
          <span class="n">${esc(e.componente)}</span>
          <span class="d">${esc(e.turma)} · encontro ${e.numero} de ${e.total}</span>
          ${e.ambiente ? `<span class="d">${esc(e.ambiente)}</span>` : ''}
        </div>`),
      ...grad.map((a) => `
        <div class="aula">
          <span class="t num">${esc(a.inicio)} – ${esc(a.fim)} · ${a.quantidade} aula${a.quantidade > 1 ? 's' : ''}</span>
          <span class="n">${esc(a.componente)}</span>
          <span class="d">${esc(a.turma)}${a.subturmas ? ' · ' + esc(a.subturmas) : ''}</span>
          ${a.ambiente ? `<span class="d">${esc(a.ambiente)}</span>` : ''}
        </div>`),
    ];
    return `
      <div class="card dia">
        <div class="dia-cab"><strong>${DIAS[d]}</strong><span class="muted num" style="font-size:12.5px">${ddmm(data)}</span></div>
        ${pos.length ? '<span class="chip chip-red" style="align-self:flex-start">Dia da pós</span>' : ''}
        ${itens.length ? itens.join('') : `<p class="vazio">${dentro ? 'Sem aulas' : 'Fora do período'}</p>`}
      </div>`;
  }).join('');

  const c = (dados.carga || []).find((x) => x.segunda === isoData(segunda));
  const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const kpis = c ? `
    <section class="kpis" aria-label="Carga da semana">
      <div class="card kpi"><span class="kl">Graduação</span><span class="kv num">${num(c.graduacao)}</span><span class="kd">aulas de 50 min</span></div>
      <div class="card kpi"><span class="kl">Aulas pós</span><span class="kv num">${c.pos50}</span><span class="kd">equiv. 50 min${c.pos_minutos ? ' · ' + duracao(c.pos_minutos) + ' reais' : ''}</span></div>
      <div class="card kpi"><span class="kl">Preparação</span><span class="kv num">${num(c.preparacao)}</span><span class="kd">20% grad · 10% pós</span></div>
      <div class="card kpi"><span class="kl">Atividades complementares / semana</span><span class="kv num">${num(c.atividades)}</span><span class="kd">sem preparação</span></div>
      <div class="card kpi" style="border-color:#F2C4CB;background:#FFF8F9"><span class="kl" style="color:var(--vermelho-escuro)">Total semanal</span><span class="kv num">${num(c.total)} <span style="font-size:15px;font-weight:600;color:var(--texto-suave)">/ 40</span></span><span class="kd">aulas equivalentes</span></div>
    </section>` : '';

  const hoje = isoData(new Date());
  const proximos = dados.pos.filter((e) => e.data >= hoje).slice(0, 12);
  const tabela = dados.pos.length ? `
    <section class="card" style="overflow:hidden">
      <div style="padding:16px 18px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline">
        <h2 style="font-size:15px">Próximos encontros da pós</h2>
        <span class="muted" style="font-size:13px">Datas já descontam feriados e dias não letivos</span>
      </div>
      <div class="tabela-box"><table>
        <thead><tr><th>Data</th><th>Turma</th><th>Módulo</th><th>Horário</th><th>Ambiente</th><th>Encontro</th></tr></thead>
        <tbody>${proximos.length ? proximos.map((e) => {
          const d = parseData(e.data);
          return `<tr><td class="num">${DIAS[((d.getDay() + 6) % 7) + 1].slice(0, 3)} ${ddmmaaaa(d)}</td><td>${esc(e.turma)}</td><td>${esc(e.componente)}</td>
            <td class="num">${esc(e.inicio)} – ${esc(e.fim)}</td><td>${esc(e.ambiente || '—')}</td><td class="num">${e.numero} de ${e.total}</td></tr>`;
        }).join('') : '<tr><td colspan="6" class="muted">Nenhum encontro futuro neste período.</td></tr>'}</tbody>
      </table></div>
    </section>` : '';

  conteudo.innerHTML = `<div style="display:flex;flex-direction:column;gap:20px"><section class="semana">${dias}</section>${kpis}${tabela}</div>`;
}
