(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* =========================================================
     1. MOTYW (Light / Dark)
     ========================================================= */
  const root = document.documentElement;
  const themeSwitch = $("#theme-switch");

  const safeStorage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignoruj */ } },
  };

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    themeSwitch.setAttribute("aria-checked", String(theme === "dark"));
    safeStorage.set("theme", theme);
    background.updateColors();
  }

  const preferred =
    safeStorage.get("theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  themeSwitch.addEventListener("click", () => {
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  /* =========================================================
     2. ZAKŁADKI
     ========================================================= */
  const tabs = $$(".tab");
  const views = { home: $("#view-home"), password: $("#view-password"), login: $("#view-login") };

  function showTab(name) {
    if (!views[name]) return;
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-current", active ? "page" : "false");
    });
    Object.entries(views).forEach(([key, el]) => {
      const active = key === name;
      el.hidden = !active;
      el.classList.toggle("is-active", active);
      if (active) { // restart animacji wejścia
        el.style.animation = "none";
        void el.offsetHeight;
        el.style.animation = "";
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    history.replaceState(null, "", "#" + name);
  }

  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $$("[data-tab-link]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showTab(el.dataset.tabLink);
    })
  );

  /* =========================================================
     3. ZEGAR (data + godzina)
     ========================================================= */
  const clockTime = $("#clock-time");
  const clockDate = $("#clock-date");
  const timeFmt = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

  function tickClock() {
    const now = new Date();
    clockTime.textContent = timeFmt.format(now);
    clockDate.textContent = dateFmt.format(now);
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* =========================================================
     4. TŁO CANVAS — cząsteczki połączone liniami
     ========================================================= */
  const background = (() => {
    const canvas = $("#bg-canvas");
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const LINK_DIST = 140;
    const MOUSE_DIST = 180;
    let particles = [];
    let w = 0, h = 0, dpr = 1;
    let color = "40, 40, 40";
    const mouse = { x: null, y: null };

    function updateColors() {
      color = getComputedStyle(root).getPropertyValue("--canvas-dot").trim() || "40, 40, 40";
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(120, Math.floor((w * h) / 14000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.4 + 0.8,
      }));
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        if (!reduceMotion) {
          p.x += p.vx;
          p.y += p.vy;
        }
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // delikatne odpychanie od kursora
        if (mouse.x !== null) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < 110 && d > 0) {
            p.x += (dx / d) * 1.2;
            p.y += (dy / d) * 1.2;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, 0.55)`;
        ctx.fill();
      }

      // linie między cząsteczkami
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK_DIST) {
            ctx.strokeStyle = `rgba(${color}, ${(1 - d / LINK_DIST) * 0.22})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // linie do kursora
        if (mouse.x !== null) {
          const p = particles[i];
          const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (d < MOUSE_DIST) {
            ctx.strokeStyle = `rgba(${color}, ${(1 - d / MOUSE_DIST) * 0.35})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(frame);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener("mouseleave", () => { mouse.x = mouse.y = null; });
    window.addEventListener("touchmove", (e) => {
      const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY;
    }, { passive: true });
    window.addEventListener("touchend", () => { mouse.x = mouse.y = null; });

    return { start() { updateColors(); resize(); frame(); }, updateColors };
  })();

  /* =========================================================
     5. GENERATOR HASEŁ
     ========================================================= */
  const SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
  };

  const els = {
    output: $("#pw-output"),
    length: $("#pw-length"),
    lengthValue: $("#pw-length-value"),
    generate: $("#pw-generate"),
    copy: $("#pw-copy"),
    copyLabel: $("#pw-copy-label"),
    bar: $("#pw-meter-bar"),
    strength: $("#pw-strength"),
    opts: {
      lower: $("#opt-lower"),
      upper: $("#opt-upper"),
      digits: $("#opt-digits"),
      symbols: $("#opt-symbols"),
    },
  };

  // Bezpieczna losowa liczba z zakresu [0, max) bez błędu modulo
  function secureRandom(max) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }

  function generatePassword() {
    const active = Object.keys(SETS).filter((k) => els.opts[k].checked);
    if (active.length === 0) {
      els.opts.lower.checked = true; // zawsze co najmniej jeden zestaw
      active.push("lower");
    }
    const length = Number(els.length.value);
    const pool = active.map((k) => SETS[k]).join("");

    // gwarancja co najmniej jednego znaku z każdego wybranego zestawu
    const chars = active.map((k) => SETS[k][secureRandom(SETS[k].length)]);
    while (chars.length < length) chars.push(pool[secureRandom(pool.length)]);

    // tasowanie Fisher–Yates
    for (let i = chars.length - 1; i > 0; i--) {
      const j = secureRandom(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    const password = chars.join("");
    els.output.textContent = password;
    updateStrength(length, pool.length);
    return password;
  }

  function updateStrength(length, poolSize) {
    const bits = length * Math.log2(poolSize);
    let label, pct;
    if (bits < 45) { label = "Słabe"; pct = 22; }
    else if (bits < 65) { label = "Średnie"; pct = 50; }
    else if (bits < 90) { label = "Silne"; pct = 78; }
    else { label = "Bardzo silne"; pct = 100; }
    els.bar.style.width = pct + "%";
    els.strength.textContent = `Siła hasła: ${label} (~${Math.round(bits)} bitów entropii)`;
  }

  async function copyPassword() {
    const text = els.output.textContent;
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback dla starszych przeglądarek / file://
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    els.copyLabel.textContent = "Skopiowano ✓";
    setTimeout(() => (els.copyLabel.textContent = "Kopiuj"), 1600);
  }

  els.length.addEventListener("input", () => {
    els.lengthValue.textContent = els.length.value;
    generatePassword();
  });
  Object.values(els.opts).forEach((o) => o.addEventListener("change", generatePassword));
  els.generate.addEventListener("click", generatePassword);
  els.copy.addEventListener("click", copyPassword);

  /* =========================================================
     5b. LOGOWANIE / REJESTRACJA (przez serwer)
     ========================================================= */
  (() => {
    const el = {
      guest: $("#auth-guest"), user: $("#auth-user"), form: $("#auth-form"),
      title: $("#auth-title"), lead: $("#auth-lead"),
      name: $("#auth-name"), email: $("#auth-email"),
      pass: $("#auth-pass"), pass2: $("#auth-pass2"), toggle: $("#auth-toggle"),
      msg: $("#auth-msg"), submit: $("#auth-submit"),
      userName: $("#auth-user-name"), userEmail: $("#auth-user-email"), logout: $("#auth-logout"),
      modeBtns: $$("[data-auth-mode]"), registerOnly: $$("[data-only='register']"),
      tab: $('.tab[data-tab="login"]'),
    };
    let mode = "login";
    const say = (t) => { el.msg.textContent = t; };

    async function api(method, path, body) {
      let res;
      try {
        res = await fetch("/api/" + path, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          credentials: "same-origin",
        });
      } catch {
        throw new Error("Brak połączenia z serwerem. Uruchom go i otwórz stronę przez localhost.");
      }
      let data = {};
      try { data = await res.json(); } catch { /* pusta odpowiedź */ }
      if (!res.ok) throw new Error(data.error || "Coś poszło nie tak.");
      return data;
    }

    function setMode(next) {
      mode = next;
      const reg = next === "register";
      el.modeBtns.forEach((b) => {
        const on = b.dataset.authMode === next;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      el.registerOnly.forEach((n) => (n.hidden = !reg));
      el.title.textContent = reg ? "Utwórz konto" : "Zaloguj się";
      el.lead.textContent = reg ? "Wystarczy imię, e-mail i hasło." : "Wpisz dane, aby wejść na swoje konto.";
      el.submit.textContent = reg ? "Utwórz konto" : "Zaloguj się";
      el.pass.autocomplete = reg ? "new-password" : "current-password";
      say("");
    }

    function render(user) {
      el.guest.hidden = !!user;
      el.user.hidden = !user;
      if (user) { el.userName.textContent = user.name; el.userEmail.textContent = user.email; }
      el.tab.textContent = user ? user.name.slice(0, 14) : "Logowanie";
    }

    el.modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.authMode)));

    el.toggle.addEventListener("click", () => {
      const show = el.pass.type === "password";
      el.pass.type = el.pass2.type = show ? "text" : "password";
      el.toggle.textContent = show ? "Ukryj" : "Pokaż";
      el.toggle.setAttribute("aria-label", show ? "Ukryj hasło" : "Pokaż hasło");
    });

    el.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = el.email.value.trim();
      const password = el.pass.value;

      if (!email) return say("Podaj adres e-mail.");
      if (password.length < 8) return say("Hasło musi mieć co najmniej 8 znaków.");
      if (mode === "register" && password !== el.pass2.value) return say("Hasła nie są takie same.");

      el.submit.disabled = true;
      say("");
      try {
        const payload = mode === "register"
          ? { name: el.name.value, email, password }
          : { email, password };
        const { user } = await api("POST", mode, payload);
        el.form.reset();
        render(user);
      } catch (err) {
        say(err.message);
      } finally {
        el.submit.disabled = false;
      }
    });

    el.logout.addEventListener("click", async () => {
      try { await api("POST", "logout", {}); } catch { /* i tak wyloguj widok */ }
      setMode("login");
      render(null);
    });

    setMode("login");
    render(null);
    api("GET", "me").then((d) => render(d.user)).catch(() => render(null));
  })();
  /* =========================================================
     6. START
     ========================================================= */
  $("#year").textContent = new Date().getFullYear();
  applyTheme(preferred);
  background.start();
  generatePassword();

  const initial = location.hash.replace("#", "");
  if (views[initial]) showTab(initial);
})();