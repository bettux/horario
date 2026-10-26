export const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// Escapa texto antes de inserir em HTML
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Datas sempre como "AAAA-MM-DD" sem fuso, para não pular dia
export function parseData(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}
export function isoData(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function somaDias(dt, n) { const x = new Date(dt); x.setDate(x.getDate() + n); return x; }
export function segundaDaSemana(dt) { const x = new Date(dt); const d = (x.getDay() + 6) % 7; x.setDate(x.getDate() - d); return x; }
export function ddmm(dt) { return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`; }
export function ddmmaaaa(dt) { return `${ddmm(dt)}/${dt.getFullYear()}`; }
export function diaIso(dt) { return ((dt.getDay() + 6) % 7) + 1; } // 1=segunda ... 7=domingo

export function duracao(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Mostra um alerta dentro de um elemento; linhas vira lista
export function mostrarAlerta(el, tipo, titulo, linhas = []) {
  if (!el) return;
  el.className = `alerta alerta-${tipo}`;
  el.innerHTML = esc(titulo) + (linhas.length ? '<ul>' + linhas.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>' : '');
  el.classList.remove('oculto');
}
export function esconder(el) { el?.classList.add('oculto'); }
