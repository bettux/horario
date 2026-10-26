// Visão semanal de um professor (usada em Minhas aulas e na Agenda docente)
import { esc, DIAS, parseData, isoData, somaDias, segundaDaSemana, ddmm, ddmmaaaa, duracao } from './util.js';

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function limitarSemana(seg, periodo) {
  const ini = segundaDaSemana(parseData(periodo.inicio));
  const fim = segundaDaSemana(parseData(periodo.fim));
  if (seg < ini) return ini;
  if (seg > fim) return fim;
  return seg;
}

export function rotuloSemana(segunda) {
  return `${ddmm(segunda)} a ${ddmmaaaa(somaDias(segunda, 5))}`;
}

// dados = resposta de minhas_aulas / agenda_professor
export function htmlSemana(dados, periodo, segunda, { mostrarProfessores = false } = {}) {
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
          ${mostrarProfessores && a.professores && a.professores.includes(' + ') ? `<span class="d">Com: ${esc(a.professores)}</span>` : ''}
          ${a.ambiente ? `<span class="d">${esc(a.ambiente)}</span>` : ''}
        </div>`),
    ];
    return `
      <div class="card dia">
        <div class="dia-cab"><strong>${DIAS[d]}</strong><span class="muted num" style="font-size:12.5px">${ddmm(data)}</span></div>
        ${pos.length ? `<span class="chip chip-red" style="align-self:flex-start">${mostrarProfessores ? 'Dia bloqueado para graduação' : 'Dia da pós'}</span>` : ''}
        ${itens.length ? itens.join('') : `<p class="vazio">${dentro ? 'Sem aulas' : 'Fora do período'}</p>`}
      </div>`;
  }).join('');

  const c = (dados.carga || []).find((x) => x.segunda === isoData(segunda));
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

  const ativ = (dados.atividades || []);
  const atividades = ativ.length ? `
    <section class="card" style="padding:14px 18px;display:flex;flex-wrap:wrap;gap:8px 24px;font-size:13.5px;align-items:baseline">
      <strong>Atividades complementares</strong>
      ${ativ.map((a) => `<span${a.frequencia === 'periodo' ? ' class="muted"' : ''}>${esc(a.descricao)} · ${num(a.quantidade)} ${a.frequencia === 'semanal' ? 'por semana' : 'no período (fora do total semanal)'}</span>`).join('')}
    </section>` : '';

  return `<div style="display:flex;flex-direction:column;gap:20px">${kpis}<section class="semana">${dias}</section>${atividades}${tabela}</div>`;
}
