// Utilidades comuns às telas do administrador
import { exigirSessao } from './auth.js';
import { montarLayout } from './layout.js';
import { q, sb } from './supabase.js';
import { esc, mostrarAlerta } from './util.js';

export async function iniciarPagina(ativo, { adm = true } = {}) {
  const perfil = await exigirSessao({ adm });
  const main = montarLayout(perfil, ativo);
  return { perfil, main };
}

// ---------- Período letivo escolhido (lembrado entre telas) ----------
export async function listarPeriodos() {
  return await q(sb.from('periodos').select('*').order('ano', { ascending: false }).order('semestre', { ascending: false }));
}
export function periodoRotulo(p) { return `${p.ano}/${p.semestre}`; }
export function periodoSalvo() { try { return localStorage.getItem('periodo-atual'); } catch { return null; } }
export function salvarPeriodo(id) { try { localStorage.setItem('periodo-atual', id); } catch { /* ignora */ } }

// Preenche um <select> de períodos e devolve o id escolhido
export function preencherPeriodos(select, periodos) {
  if (!periodos.length) { select.innerHTML = '<option value="">Nenhum período</option>'; select.disabled = true; return null; }
  select.disabled = false;
  select.innerHTML = periodos.map((p) => `<option value="${p.id}">${periodoRotulo(p)}</option>`).join('');
  const salvo = periodoSalvo();
  const hoje = new Date().toISOString().slice(0, 10);
  const escolhido = periodos.find((p) => p.id === salvo) || periodos.find((p) => p.inicio <= hoje && hoje <= p.fim) || periodos[0];
  select.value = escolhido.id;
  select.addEventListener('change', () => salvarPeriodo(select.value));
  return escolhido.id;
}

// ---------- Avisos rápidos ----------
export function avisar(texto, tipo = 'ok') {
  let box = document.getElementById('avisos');
  if (!box) {
    box = document.createElement('div');
    box.id = 'avisos';
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:50;max-width:min(420px,calc(100vw - 32px))';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `alerta alerta-${tipo}`;
  el.style.boxShadow = '0 6px 20px rgba(20,20,30,.12)';
  el.textContent = texto;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// Mostra o erro (com lista de motivos, se houver) num elemento de alerta
export function mostrarErro(el, e) {
  mostrarAlerta(el, 'erro', e.linhas?.length ? e.message : e.message, e.linhas || []);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Janela de diálogo simples ----------
// abrirDialogo({ titulo, corpo (html), confirmar: 'Salvar', aoConfirmar: async (dlg) => {} })
export function abrirDialogo({ titulo, corpo, confirmar = 'Salvar', perigo = false, aoConfirmar }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo';
  dlg.innerHTML = `
    <form method="dialog" class="dialogo-form">
      <h2>${esc(titulo)}</h2>
      <div class="dialogo-corpo">${corpo}</div>
      <div class="oculto" data-msg role="alert"></div>
      <div class="dialogo-acoes">
        <button type="button" class="btn" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-p${perigo ? ' btn-perigo' : ''}" data-ok>${esc(confirmar)}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const msg = dlg.querySelector('[data-msg]');
  const ok = dlg.querySelector('[data-ok]');
  dlg.querySelector('[data-cancelar]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.classList.add('oculto');
    ok.disabled = true;
    try {
      await aoConfirmar?.(dlg);
      dlg.close();
    } catch (e) {
      mostrarErro(msg, e);
    } finally {
      ok.disabled = false;
    }
  });
  dlg.showModal();
  dlg.querySelector('input, select, textarea')?.focus();
  return dlg;
}

export function confirmar(titulo, texto, rotulo = 'Confirmar', perigo = false) {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = abrirDialogo({ titulo, corpo: `<p style="margin:0;line-height:1.55">${esc(texto)}</p>`, confirmar: rotulo, perigo, aoConfirmar: () => { ok = true; } });
    dlg.addEventListener('close', () => resolve(ok));
  });
}
