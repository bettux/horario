// Cores dos professores: 36 tons bem diferentes entre si (sem o vermelho da marca).
// O bloco de aula usa um fundo suave e o texto na versão escura da mesma cor.
export const CORES_PROFESSORES = [
  '#EA580C', '#D97706', '#CA8A04', '#65A30D', '#16A34A', '#059669', '#0D9488', '#0891B2', '#0284C7',
  '#2563EB', '#4F46E5', '#7C3AED', '#9333EA', '#C026D3', '#DB2777', '#475569', '#92400E', '#065F46',
  '#FB923C', '#FBBF24', '#EAB308', '#A3E635', '#4ADE80', '#34D399', '#2DD4BF', '#22D3EE', '#38BDF8',
  '#60A5FA', '#818CF8', '#A78BFA', '#C084FC', '#E879F9', '#F472B6', '#94A3B8', '#1E40AF', '#6B21A8',
];

// Cores usadas na planilha da coordenação (padrão do Excel), para o sistema ficar parecido com ela
export const CORES_PLANILHA = [
  '#00B0F0', '#0070C0', '#156082', '#7030A0', '#FF00FF', '#C00000', '#E97132', '#FFC000', '#FFFF00', '#000000',
];

function rgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
}
const hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const misturar = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// fundo suave, borda na cor e texto escuro da mesma família
export function tons(cor) {
  const c = rgb(cor || '#8A8A93');
  return {
    fundo: hex(misturar(c, [255, 255, 255], 0.8)),
    borda: hex(c),
    texto: hex(misturar(c, [0, 0, 0], 0.55)),
    suave: hex(misturar(c, [0, 0, 0], 0.35)),
  };
}

// primeira cor da paleta que ninguém usa (se todas estiverem em uso, a menos usada)
export function proximaCor(usadas) {
  const conta = new Map(CORES_PROFESSORES.map((c) => [c, 0]));
  for (const u of usadas) if (conta.has(String(u).toUpperCase())) conta.set(String(u).toUpperCase(), conta.get(String(u).toUpperCase()) + 1);
  return [...conta.entries()].sort((a, b) => a[1] - b[1])[0][0];
}
