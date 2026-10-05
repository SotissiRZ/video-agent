// Applied before first paint (no flash): theme and language from the saved preference or the system.
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('va.theme');
    if (theme !== 'light' && theme !== 'dark') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.dataset.theme = theme;
    var lang = localStorage.getItem('va.lang');
    if (lang !== 'fr' && lang !== 'en') lang = (navigator.language || 'fr').slice(0, 2) === 'fr' ? 'fr' : 'en';
    root.lang = lang;
  } catch (e) {
    root.dataset.theme = 'light';
  }
})();
