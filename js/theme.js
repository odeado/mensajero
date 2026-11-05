// Se carga antes del CSS para recuperar el tema sin un destello del anterior.
(() => {
  const key = 'mensajero_theme';
  const themes = {
    original: { color: '#202c33' },
    dark: { color: '#14161a' }
  };
  const normalize = (value) => Object.hasOwn(themes, value) ? value : 'original';
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themes[theme].color);
    const select = document.getElementById('theme-select');
    if (select) select.value = theme;
  }
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  apply(saved);
  function bind() {
    const select = document.getElementById('theme-select');
    if (!select) return;
    select.value = normalize(document.documentElement.dataset.theme);
    select.addEventListener('change', () => {
      const theme = normalize(select.value);
      apply(theme);
      try { localStorage.setItem(key, theme); } catch {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
