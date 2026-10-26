import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro, confirmar } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, parseData, ddmm } from './util.js';

const { main } = await iniciarPagina('atividades');

main.innerHTML = `
  <header class="cabecalho"><div>
    <h1>Atividades complementares</h1>
    <p class="sub">Coordenação, orientação de TCC e outras atividades. Não recebem os 20% de preparação.</p>
  </div></header>
  <section class="card barra">
    <div class="campo" style="flex:0 1 160px"><label for="per">Período letivo</label><select id="per"></select></div>
    <div class="campo" style="flex:1 1 280px"><label for="prof">Professor</label><select id="prof"></select></div>
  </section>
  <div class="duas-colunas">
    <section class="larga" style="display:flex;flex-direction:column;gap:16px">
      <div class="card tabela-box" id="lista"></div>
      <form class="card painel" id="form" novalidate>
        <h2 id="titulo-form">Nova atividade</h2>
        <div class="linha-form">
          <div class="campo"><label for="desc">Descrição</label><input id="desc" placeholder="Ex.: Orientação de TCC" required></div>
          <div class="campo"><label for="qtd">Quantidade (aulas equivalentes)</label><input id="qtd" type="number" min="0.5" step="0.5" required></div>
          <div class="campo"><label for="obs">Observação</label><input id="obs"></div>
        </div>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="rotulo" style="padding:0;margin-bottom:8px">Frequência</legend>
          <div style="display:flex;gap:22px;flex-wrap:wrap">
            <label class="check"><input type="radio" name="freq" value="semanal" checked> Semanal (entra no total da semana)</label>
            <label class="check"><input type="radio" name="freq" value="periodo"> Total do período (informativo)</label>
          </div>
        </fieldset>
        <div id="msg" class="oculto" role="alert"></div>
        <div style="display:flex;gap:10px"><button class="btn btn-p" type="submit">Adicionar atividade</button><button class="btn" type="button" id="cancelar">Cancelar</button></div>
      </form>
    </section>
    <aside class="card estreita painel" id="resumo"></aside>
  </div>`;

const [periodos, profs] = await Promise.all([listarPeriodos(), q(sb.from('professores').select('id, nome, nif').eq('ativo', true).order('nome'))]);
const selPer = main.querySelector('#per'), selProf = main.querySelector('#prof'), form = main.querySelector('#form');
let periodoId = preencherPeriodos(selPer, periodos);
selProf.innerHTML = profs.map((p) => `<option value="${p.id}">${esc(p.nome)} · NIF ${esc(p.nif)}</option>`).join('');
let editando = null, atividades = [];

if (periodoId && profs.length) {
  carregar();
  selPer.addEventListener('change', () => { periodoId = selPer.value; carregar(); });
  selProf.addEventListener('change', carregar);
} else {
  main.querySelector('#lista').innerHTML = '<p class="muted" style="padding:16px">Cadastre um período e professores primeiro.</p>';
  form.querySelector('[type=submit]').disabled = true;
}

async function carregar() {
  limparForm();
  const prof = selProf.value;
  const [ativ, carga] = await Promise.all([
    q(sb.from('atividades').select('*').eq('professor_id', prof).eq('periodo_id', periodoId).order('descricao')),
    rpc('carga_todos', { p_periodo: periodoId }),
  ]);
  atividades = ativ;
  main.querySelector('#lista').innerHTML = `<table>
    <thead><tr><th>Descrição</th><th style="text-align:right">Quantidade</th><th>Frequência</th><th>Observação</th><th></th></tr></thead>
    <tbody>${ativ.length ? ativ.map((a) => `<tr><td>${esc(a.descricao)}</td><td class="num" style="text-align:right">${Number(a.quantidade).toLocaleString('pt-BR')}</td>
      <td>${a.frequencia === 'semanal' ? '<span class="chip chip-red">Semanal</span>' : '<span class="chip chip-neu">Total do período</span>'}</td>
      <td class="muted">${esc(a.observacao || '')}</td>
      <td><div class="acoes"><button class="btn btn-s" data-editar="${a.id}">Editar</button><button class="btn btn-s" data-excluir="${a.id}">Excluir</button></div></td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Nenhuma atividade neste período.</td></tr>'}</tbody></table>`;
  main.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => preencherForm(ativ.find((a) => a.id === b.dataset.editar))));
  main.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Excluir atividade?', 'A carga do professor será recalculada.', 'Excluir'))) return;
    try { await q(sb.from('atividades').delete().eq('id', b.dataset.excluir)); avisar('Atividade excluída.'); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }));

  const semanas = carga.filter((c) => c.professor_id === prof);
  const pico = semanas.reduce((m, c) => (Number(c.total) > Number(m?.total ?? -1) ? c : m), null);
  const nome = profs.find((p) => p.id === prof)?.nome.split(' ')[0];
  const temAula = semanas.some((c) => Number(c.graduacao) > 0 || c.pos_minutos > 0);
  const num = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const periodoTotal = ativ.filter((a) => a.frequencia === 'periodo').reduce((s, a) => s + Number(a.quantidade), 0);
  main.querySelector('#resumo').innerHTML = pico ? `
    <h2>Carga semanal de ${esc(nome)}</h2>
    <span class="muted" style="font-size:12.5px">Semana de maior carga do período (semana ${pico.semana}, ${ddmm(parseData(pico.segunda))})</span>
    ${linha('Ensino com preparação', num(pico.ensino))}
    ${linha('Atividades semanais', num(pico.atividades))}
    ${linha('<strong>Total</strong>', `<strong>${num(pico.total)} de 40</strong>`)}
    ${linha('Ainda cabe por semana', num(Math.max(0, 40 - Number(pico.total))))}
    ${periodoTotal ? linha('Atividades do período (fora da semana)', num(periodoTotal)) : ''}
    <p class="muted" style="margin:6px 0 0;font-size:12.5px;line-height:1.5">${temAula ? 'O limite de 40 vale para toda semana do período.' : 'Professor sem nenhuma aula no período não pode receber atividade semanal.'}</p>` : '<p class="muted">Sem dados de carga.</p>';
}

function linha(a, b) { return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13.5px;padding:8px 0;border-bottom:1px solid #F0F0F3"><span>${a}</span><span class="num">${b}</span></div>`; }

function preencherForm(a) {
  editando = a;
  main.querySelector('#titulo-form').textContent = 'Editar atividade';
  form.querySelector('[type=submit]').textContent = 'Salvar atividade';
  form.desc.value = a.descricao; form.qtd.value = a.quantidade; form.obs.value = a.observacao || '';
  form.querySelector(`input[name=freq][value=${a.frequencia}]`).checked = true;
  form.desc.focus();
}
function limparForm() {
  editando = null; form.reset();
  main.querySelector('#titulo-form').textContent = 'Nova atividade';
  form.querySelector('[type=submit]').textContent = 'Adicionar atividade';
  form.querySelector('#msg').classList.add('oculto');
}
main.querySelector('#cancelar').addEventListener('click', limparForm);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = form.querySelector('#msg');
  try {
    const desc = form.desc.value.trim(), qtd = Number(form.qtd.value);
    if (!desc) throw new Error('Informe a descrição.');
    if (!(qtd > 0)) throw new Error('A quantidade precisa ser maior que zero.');
    await rpc('salvar_atividade', {
      p_id: editando?.id ?? null, p_prof: selProf.value, p_periodo: periodoId, p_descricao: desc,
      p_quantidade: qtd, p_frequencia: form.querySelector('input[name=freq]:checked').value, p_observacao: form.obs.value.trim() || null,
    });
    avisar(editando ? 'Atividade salva.' : 'Atividade adicionada.');
    carregar();
  } catch (e) { mostrarErro(msg, e); }
});
