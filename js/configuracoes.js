import { iniciarPagina, listarPeriodos, periodoRotulo, preencherPeriodos, avisar, abrirDialogo, confirmar, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, parseData, ddmmaaaa, DIAS, diaIso, mostrarAlerta } from './util.js';

const { main } = await iniciarPagina('configuracoes');

main.innerHTML = `
  <header class="cabecalho"><div>
    <h1>Configurações acadêmicas</h1>
    <p class="sub">Períodos, feriados, horários e ambientes. Tudo pela tela, sem SQL.</p>
  </div></header>
  <div class="abas" role="tablist" aria-label="Seções">
    <button class="aba" role="tab" data-aba="periodos">Períodos letivos</button>
    <button class="aba" role="tab" data-aba="feriados">Dias não letivos</button>
    <button class="aba" role="tab" data-aba="horarios">Horários</button>
    <button class="aba" role="tab" data-aba="ambientes">Ambientes</button>
  </div>
  <div id="area"></div>`;

const area = main.querySelector('#area');
const abas = { periodos: abaPeriodos, feriados: abaFeriados, horarios: abaHorarios, ambientes: abaAmbientes };
let abaAtual = (() => { try { return sessionStorage.getItem('config-aba') || 'periodos'; } catch { return 'periodos'; } })();

main.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => abrir(b.dataset.aba)));
abrir(abaAtual);

function abrir(nome) {
  abaAtual = nome;
  try { sessionStorage.setItem('config-aba', nome); } catch { /* ignora */ }
  main.querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  area.innerHTML = '<p class="carregando">Carregando…</p>';
  abas[nome]().catch((e) => { area.innerHTML = '<div></div>'; mostrarErro(area.firstChild, e); });
}

// ================= Períodos =================
async function abaPeriodos() {
  const periodos = await listarPeriodos();
  const hoje = new Date().toISOString().slice(0, 10);
  area.innerHTML = `
    <div class="duas-colunas">
      <section class="card larga tabela-box">
        <table>
          <thead><tr><th>Período</th><th>Início</th><th>Fim</th><th>Semanas</th><th>Situação</th><th></th></tr></thead>
          <tbody>${periodos.length ? periodos.map((p) => {
            const sem = Math.ceil((parseData(p.fim) - parseData(p.inicio) + 86400000) / (7 * 86400000));
            const sit = hoje < p.inicio ? '<span class="chip chip-aviso">Futuro</span>' : hoje > p.fim ? '<span class="chip chip-neu">Encerrado</span>' : '<span class="chip chip-ok">Em andamento</span>';
            return `<tr><td><strong>${periodoRotulo(p)}</strong></td><td class="num">${ddmmaaaa(parseData(p.inicio))}</td><td class="num">${ddmmaaaa(parseData(p.fim))}</td>
              <td class="num">${sem}</td><td>${sit}</td><td><div class="acoes"><button class="btn btn-s" data-editar="${p.id}">Editar</button></div></td></tr>`;
          }).join('') : '<tr><td colspan="6" class="muted">Nenhum período cadastrado. Crie o primeiro ao lado.</td></tr>'}</tbody>
        </table>
      </section>
      <form class="card estreita painel" id="novo">
        <h2>Novo período</h2>
        <div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="campo"><label for="ano">Ano</label><input id="ano" type="number" min="2020" max="2100" required value="${new Date().getFullYear() + 1}"></div>
          <div class="campo"><label for="sem">Semestre</label><select id="sem"><option>1</option><option>2</option></select></div>
          <div class="campo"><label for="ini">Início</label><input id="ini" type="date" required></div>
          <div class="campo"><label for="fim">Fim</label><input id="fim" type="date" required></div>
        </div>
        <span class="muted" style="font-size:12.5px">Não aceita período repetido nem início depois do fim. A disponibilidade dos professores começa vazia em cada período.</span>
        <div id="msg" class="oculto" role="alert"></div>
        <button class="btn btn-p" type="submit">Criar período</button>
      </form>
    </div>`;

  const form = area.querySelector('#novo');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (!form.ini.value || !form.fim.value) throw new Error('Informe início e fim.');
      if (form.ini.value > form.fim.value) throw new Error('O início precisa ser antes do fim.');
      await q(sb.from('periodos').insert({ ano: +form.ano.value, semestre: +form.sem.value, inicio: form.ini.value, fim: form.fim.value }));
      avisar('Período criado.');
      abrir('periodos');
    } catch (e) { mostrarErro(form.querySelector('#msg'), e); }
  });

  area.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
    const p = periodos.find((x) => x.id === b.dataset.editar);
    abrirDialogo({
      titulo: `Editar período ${periodoRotulo(p)}`,
      corpo: `<div class="linha-form" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="campo"><label for="e-ini">Início</label><input id="e-ini" type="date" value="${p.inicio}" required></div>
        <div class="campo"><label for="e-fim">Fim</label><input id="e-fim" type="date" value="${p.fim}" required></div></div>
        <span class="muted" style="font-size:12.5px">Encontros de pós que ficarem fora das novas datas aparecem na Auditoria.</span>`,
      aoConfirmar: async (dlg) => {
        const ini = dlg.querySelector('#e-ini').value, fim = dlg.querySelector('#e-fim').value;
        if (ini > fim) throw new Error('O início precisa ser antes do fim.');
        await q(sb.from('periodos').update({ inicio: ini, fim }).eq('id', p.id));
        avisar('Período atualizado.'); abrir('periodos');
      },
    });
  }));
}

// ================= Dias não letivos =================
async function abaFeriados() {
  const periodos = await listarPeriodos();
  area.innerHTML = `
    <div class="alerta alerta-aviso">Cadastrar um dia não letivo nunca apaga nem move aulas já salvas. Se houver encontro de pós nesse dia, ele aparece na Auditoria para você remarcar. A graduação não é afetada (é compensada aos sábados).</div>
    <div class="duas-colunas" style="margin-top:16px">
      <section class="card larga">
        <div class="barra" style="border-bottom:1px solid var(--linha)"><div class="campo" style="width:160px"><label for="per">Período letivo</label><select id="per"></select></div></div>
        <div class="tabela-box" id="lista"></div>
      </section>
      <form class="card estreita painel" id="novo">
        <h2>Novo dia não letivo</h2>
        <div class="campo"><label for="data">Data</label><input id="data" type="date" required></div>
        <div class="campo"><label for="motivo">Motivo</label><input id="motivo" placeholder="Ex.: Recesso escolar" required></div>
        <div id="msg" class="oculto" role="alert"></div>
        <button class="btn btn-p" type="submit">Adicionar</button>
      </form>
    </div>`;
  const sel = area.querySelector('#per');
  let periodoId = preencherPeriodos(sel, periodos);
  const form = area.querySelector('#novo');
  if (!periodoId) { area.querySelector('#lista').innerHTML = '<p class="muted" style="padding:16px">Crie um período primeiro.</p>'; form.querySelector('button').disabled = true; return; }

  async function listar() {
    const dias = await q(sb.from('v_dias_nao_letivos').select('*').eq('periodo_id', periodoId).order('data'));
    area.querySelector('#lista').innerHTML = `<table>
      <thead><tr><th>Data</th><th>Motivo</th><th>Encontros de pós nesse dia</th><th></th></tr></thead>
      <tbody>${dias.length ? dias.map((d) => {
        const dt = parseData(d.data);
        return `<tr><td class="num">${DIAS[diaIso(dt)].slice(0, 3)} ${ddmmaaaa(dt)}</td><td>${esc(d.motivo)}</td>
          <td>${d.encontros_afetados ? `<span class="chip chip-erro">${d.encontros_afetados} para remarcar</span>` : '<span class="muted">Nenhum</span>'}</td>
          <td><div class="acoes"><button class="btn btn-s" data-remover="${d.id}">Remover</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="4" class="muted">Nenhum dia não letivo neste período.</td></tr>'}</tbody></table>`;
    area.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('Remover dia não letivo?', 'O dia volta a ser letivo para a pós.', 'Remover'))) return;
      try { await q(sb.from('dias_nao_letivos').delete().eq('id', b.dataset.remover)); avisar('Dia removido.'); listar(); }
      catch (e) { avisar(e.message, 'erro'); }
    }));
  }
  sel.addEventListener('change', () => { periodoId = sel.value; listar(); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const p = periodos.find((x) => x.id === periodoId);
      if (!form.data.value) throw new Error('Informe a data.');
      if (form.data.value < p.inicio || form.data.value > p.fim) throw new Error(`A data precisa estar dentro do período ${periodoRotulo(p)}.`);
      if (!form.motivo.value.trim()) throw new Error('Informe o motivo.');
      await q(sb.from('dias_nao_letivos').insert({ periodo_id: periodoId, data: form.data.value, motivo: form.motivo.value.trim() }));
      form.reset(); avisar('Dia não letivo adicionado.'); listar();
    } catch (e) { mostrarErro(form.querySelector('#msg'), e); }
  });
  listar();
}

// ================= Horários =================
async function abaHorarios() {
  const [grad, pos] = await Promise.all([
    q(sb.from('horarios_graduacao').select('*').order('tipo_dia', { ascending: false }).order('numero')),
    q(sb.from('horarios_pos').select('*')),
  ]);
  const linhaGrad = (h) => `<div class="linha-form" style="grid-template-columns:110px 1fr 1fr;align-items:center">
    <span>${h.numero}ª aula</span>
    <input type="time" aria-label="${h.numero}ª aula início" data-g="${h.tipo_dia}|${h.numero}|inicio" value="${h.inicio.slice(0, 5)}">
    <input type="time" aria-label="${h.numero}ª aula fim" data-g="${h.tipo_dia}|${h.numero}|fim" value="${h.fim.slice(0, 5)}"></div>`;
  const nomesPos = { '10_semanas': '10 semanas', '8_semanas': '8 semanas', manha: 'Sábado manhã', tarde: 'Sábado tarde' };
  const ordemPos = ['10_semanas', '8_semanas', 'manha', 'tarde'];
  area.innerHTML = `
    <div class="duas-colunas">
      <section class="card estreita painel">
        <h2>Graduação · noite (50 min)</h2>
        ${grad.filter((h) => h.tipo_dia === 'semana').map(linhaGrad).join('')}
        <h2 style="margin-top:8px">Graduação · sábado (EAD e Extensão)</h2>
        ${grad.filter((h) => h.tipo_dia === 'sabado').map(linhaGrad).join('')}
      </section>
      <section class="card estreita painel">
        <h2>Pós-graduação</h2>
        <p class="muted" style="margin:0;font-size:12.5px">"Minutos de aula" é o tempo efetivo (sem intervalo) usado na carga docente.</p>
        <div class="linha-form" style="grid-template-columns:130px 1fr 1fr 1fr;font-size:12px;font-weight:600;color:var(--texto-suave)"><span>Formato</span><span>Início</span><span>Fim</span><span>Minutos de aula</span></div>
        ${ordemPos.map((f) => pos.find((p) => p.formato === f)).filter(Boolean).map((p) => `
          <div class="linha-form" style="grid-template-columns:130px 1fr 1fr 1fr;align-items:center">
            <span>${nomesPos[p.formato]}</span>
            <input type="time" aria-label="${nomesPos[p.formato]} início" data-p="${p.formato}|inicio" value="${p.inicio.slice(0, 5)}">
            <input type="time" aria-label="${nomesPos[p.formato]} fim" data-p="${p.formato}|fim" value="${p.fim.slice(0, 5)}">
            <input type="number" min="1" aria-label="${nomesPos[p.formato]} minutos" data-p="${p.formato}|minutos_aula" value="${p.minutos_aula}"></div>`).join('')}
        <div id="msg" class="oculto" role="alert"></div>
        <button class="btn btn-p" type="button" id="salvar" style="align-self:flex-start">Salvar horários</button>
        <p class="muted" style="margin:0;font-size:12.5px">Mudanças valem para as próximas alocações. Aulas já salvas usam os novos horários na exibição; confira a Auditoria depois de alterar.</p>
      </section>
    </div>`;
  area.querySelector('#salvar').addEventListener('click', async () => {
    const msg = area.querySelector('#msg');
    try {
      const g = {}; area.querySelectorAll('[data-g]').forEach((i) => { const [t, n, c] = i.dataset.g.split('|'); (g[`${t}|${n}`] ??= { tipo_dia: t, numero: +n })[c] = i.value; });
      const p = {}; area.querySelectorAll('[data-p]').forEach((i) => { const [f, c] = i.dataset.p.split('|'); (p[f] ??= { formato: f })[c] = c === 'minutos_aula' ? +i.value : i.value; });
      for (const h of [...Object.values(g), ...Object.values(p)]) if (!h.inicio || !h.fim || h.inicio >= h.fim) throw new Error('Cada horário precisa ter início antes do fim.');
      await q(sb.from('horarios_graduacao').upsert(Object.values(g)));
      await q(sb.from('horarios_pos').upsert(Object.values(p)));
      avisar('Horários salvos.');
      msg.classList.add('oculto');
    } catch (e) { mostrarErro(msg, e); }
  });
}

// ================= Ambientes =================
async function abaAmbientes() {
  const amb = await q(sb.from('v_ambientes_uso').select('*').order('nome'));
  area.innerHTML = `
    <div class="alerta alerta-aviso">Ambientes são criados quando você digita o nome numa aula. Aqui você renomeia ou junta ambientes duplicados (ex.: "Lab 3" e "Lab. 03").</div>
    <section class="card tabela-box" style="margin-top:16px"><table>
      <thead><tr><th>Ambiente</th><th style="text-align:right">Aulas de graduação</th><th style="text-align:right">Encontros de pós</th><th></th></tr></thead>
      <tbody>${amb.length ? amb.map((a) => `<tr><td>${esc(a.nome)}</td><td class="num" style="text-align:right">${a.aulas}</td><td class="num" style="text-align:right">${a.encontros}</td>
        <td><div class="acoes"><button class="btn btn-s" data-renomear="${a.id}">Renomear</button><button class="btn btn-s" data-juntar="${a.id}">Juntar com…</button>
        ${a.aulas + a.encontros === 0 ? `<button class="btn btn-s" data-excluir="${a.id}">Excluir</button>` : ''}</div></td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">Nenhum ambiente ainda. Eles aparecem quando você salva aulas com ambiente.</td></tr>'}</tbody></table></section>`;

  area.querySelectorAll('[data-renomear]').forEach((b) => b.addEventListener('click', () => {
    const a = amb.find((x) => x.id === b.dataset.renomear);
    abrirDialogo({
      titulo: 'Renomear ambiente',
      corpo: `<div class="campo"><label for="n">Nome</label><input id="n" value="${esc(a.nome)}" required></div>`,
      aoConfirmar: async (dlg) => {
        const nome = dlg.querySelector('#n').value.trim().replace(/\s+/g, ' ');
        if (!nome) throw new Error('Informe o nome.');
        try { await q(sb.from('ambientes').update({ nome }).eq('id', a.id)); }
        catch (e) { if (e.codigo === '23505') throw new Error('Já existe um ambiente com esse nome. Use "Juntar com…".'); throw e; }
        avisar('Ambiente renomeado.'); abrir('ambientes');
      },
    });
  }));
  area.querySelectorAll('[data-juntar]').forEach((b) => b.addEventListener('click', () => {
    const a = amb.find((x) => x.id === b.dataset.juntar);
    const outros = amb.filter((x) => x.id !== a.id);
    if (!outros.length) { avisar('Não há outro ambiente para juntar.', 'aviso'); return; }
    abrirDialogo({
      titulo: `Juntar "${a.nome}" com…`,
      corpo: `<div class="campo"><label for="d">Ambiente que fica</label><select id="d">${outros.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></div>
        <p class="muted" style="margin:0;font-size:13px">Todas as aulas de "${esc(a.nome)}" passam para o ambiente escolhido e "${esc(a.nome)}" deixa de existir. Se isso criar choque de horário, nada é alterado.</p>`,
      confirmar: 'Juntar',
      aoConfirmar: async (dlg) => { await rpc('juntar_ambientes', { p_origem: a.id, p_destino: dlg.querySelector('#d').value }); avisar('Ambientes juntados.'); abrir('ambientes'); },
    });
  }));
  area.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Excluir ambiente?', 'Ele não tem nenhuma aula.', 'Excluir'))) return;
    try { await q(sb.from('ambientes').delete().eq('id', b.dataset.excluir)); avisar('Ambiente excluído.'); abrir('ambientes'); }
    catch (e) { avisar(e.message, 'erro'); }
  }));
}
