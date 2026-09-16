/* v9 — portaria robusta: cache persistente + sincronização tolerante */
(() => {
  "use strict";

  const CONFIG = window.PORTARIA_CONFIG || {};
  const API_URL = CONFIG.API_URL || "";
  const AUTO_REFRESH_MS = Number(CONFIG.AUTO_REFRESH_MS || 30000);
  const CACHE_KEY = "luciene_portaria_lista";

  const state = {
    guests: [],
    filter: "all",
    query: "",
    undoTarget: null,
    refreshTimer: null,
    loadPromise: null,
    consecutiveFailures: 0,
    hasKnownList: false,

    // Permite clicar em "desfazer" mesmo enquanto uma gravação anterior ainda está chegando ao Google.
    desiredCheckin: new Map(),
    savingIds: new Set()
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    guestList: $("#guestList"),
    loading: $("#loadingState"),
    error: $("#errorState"),
    empty: $("#emptyState"),
    errorMessage: $("#errorMessage"),
    totalConfirmed: $("#totalConfirmed"),
    totalEntered: $("#totalEntered"),
    totalWaiting: $("#totalWaiting"),
    resultCount: $("#resultCount"),
    listTitle: $("#listTitle"),
    search: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    refresh: $("#refreshButton"),
    retry: $("#retryButton"),
    connectionDot: $("#connectionDot"),
    connectionLabel: $("#connectionLabel"),
    lastSyncLabel: $("#lastSyncLabel"),
    toastStack: $("#toastStack"),
    confirmBackdrop: $("#confirmBackdrop"),
    confirmTitle: $("#confirmTitle"),
    confirmText: $("#confirmText"),
    cancelDialog: $("#cancelDialog"),
    confirmDialog: $("#confirmDialog")
  };

  function normalize(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function formatPersonName(value = "") {
    const original = String(value || "").trim();
    if (!original) return "";

    const lowerWords = new Set(["da", "das", "de", "do", "dos", "e"]);

    const formatPart = (part, index) => {
      const lower = part.toLocaleLowerCase("pt-BR");

      if (index > 0 && lowerWords.has(lower)) {
        return lower;
      }

      return lower
        .split("-")
        .map(segment =>
          segment
            .split("'")
            .map(piece =>
              piece
                ? piece.charAt(0).toLocaleUpperCase("pt-BR") + piece.slice(1)
                : piece
            )
            .join("'")
        )
        .join("-");
    };

    return original
      .replace(/\s+/g, " ")
      .split(" ")
      .map(formatPart)
      .join(" ");
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "•";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function setView(view) {
    elements.loading.classList.toggle("hidden", view !== "loading");
    elements.error.classList.toggle("hidden", view !== "error");
    elements.empty.classList.toggle("hidden", view !== "empty");
    elements.guestList.classList.toggle("hidden", view !== "list");
  }

  function setSyncing(message = "Buscando dados atualizados") {
    elements.connectionDot.classList.remove("offline");
    elements.connectionDot.classList.remove("online");
    elements.connectionLabel.textContent = "Sincronizando…";
    elements.lastSyncLabel.textContent = message;
  }

  function setOnline() {
    const now = new Date();
    elements.connectionDot.classList.remove("offline");
    elements.connectionDot.classList.add("online");
    elements.connectionLabel.textContent = "Lista sincronizada";
    elements.lastSyncLabel.textContent =
      `Atualizada às ${now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      })}`;
  }

  function setConnectionProblem() {
    elements.connectionDot.classList.remove("online");

    /*
     * Uma única demora do Google não significa que a internet caiu.
     * Nas duas primeiras falhas, mantemos "Sincronizando…".
     * Só depois de 3 falhas consecutivas mostramos "Conexão instável".
     */
    if (state.consecutiveFailures < 3) {
      elements.connectionDot.classList.remove("offline");
      elements.connectionLabel.textContent = "Sincronizando…";
      elements.lastSyncLabel.textContent = state.hasKnownList
        ? "Exibindo a última lista disponível"
        : "O Google está demorando para responder";
      return;
    }

    elements.connectionDot.classList.add("offline");
    elements.connectionLabel.textContent = "Conexão instável";
    elements.lastSyncLabel.textContent = state.hasKnownList
      ? "Exibindo a última lista disponível"
      : "Não foi possível carregar os dados ainda";
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastStack.appendChild(toast);

    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      window.setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function mapPeople(people) {
    return people
      .map(person => ({
        id: String(person.id),
        nome: String(person.nome || "").trim(),
        grupo: String(person.grupo || "").trim(),
        tipo: String(person.tipo || ""),
        entrou: Boolean(person.entrou),
        horarioEntrada: person.horarioEntrada || ""
      }))
      .filter(person => person.nome)
      .sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
      );
  }

  function saveCache() {
    state.hasKnownList = true;

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          guests: state.guests
        })
      );
    } catch (_) {}
  }

  function restoreCache() {
    try {
      /*
       * CACHE_KEY é propositalmente estável.
       * Assim, atualizar app.js no GitHub NÃO apaga a última lista salva.
       *
       * Também tentamos migrar a chave da versão anterior para não perder
       * o cache de quem já abriu a página antes desta atualização.
       */
      let raw = localStorage.getItem(CACHE_KEY);

      if (!raw) {
        const legacyKeys = [
          "luciene_portaria_lista_v8"
        ];

        for (const legacyKey of legacyKeys) {
          const legacyRaw = localStorage.getItem(legacyKey);

          if (legacyRaw) {
            raw = legacyRaw;
            localStorage.setItem(CACHE_KEY, legacyRaw);
            break;
          }
        }
      }

      if (!raw) return false;

      const cached = JSON.parse(raw);

      if (!cached || !Array.isArray(cached.guests)) {
        return false;
      }

      state.guests = cached.guests;
      state.hasKnownList = true;

      /*
       * Mesmo que a última lista válida tenha 0 convidados,
       * ainda é um estado válido e pode ser mostrado enquanto sincroniza.
       */
      render();

      const time = cached.savedAt
        ? new Date(cached.savedAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
          })
        : "";

      setSyncing(
        time
          ? `Exibindo a última lista disponível · salva às ${time}`
          : "Exibindo a última lista disponível"
      );

      return true;
    } catch (_) {
      return false;
    }
  }

  function jsonpRequest(params = {}, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      if (!API_URL) {
        reject(new Error("API_URL não configurada."));
        return;
      }

      const callbackName =
        `__lucieneApi_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const script = document.createElement("script");

      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("O Google demorou mais que o esperado para responder."));
      }, timeoutMs);

      function cleanup() {
        window.clearTimeout(timeout);

        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }

        script.remove();
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      const url = new URL(API_URL);

      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });

      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", Date.now());

      script.src = url.toString();
      script.async = true;

      script.onerror = () => {
        cleanup();
        reject(new Error("Não foi possível acessar o Google Apps Script."));
      };

      document.head.appendChild(script);
    });
  }

  function getFilteredGuests() {
    const q = normalize(state.query);

    return state.guests.filter(guest => {
      const matchesSearch =
        !q ||
        normalize(guest.nome).includes(q) ||
        normalize(guest.grupo).includes(q);

      let matchesFilter = true;

      if (state.filter === "entered") matchesFilter = !!guest.entrou;
      if (state.filter === "waiting") matchesFilter = !guest.entrou;

      return matchesSearch && matchesFilter;
    });
  }

  function updateMetrics() {
    /*
     * Antes da primeira lista conhecida: "—".
     * Depois que já tivemos uma lista válida (cache ou Google),
     * mostramos os ÚLTIMOS números conhecidos durante qualquer atualização.
     */
    if (!state.hasKnownList) {
      elements.totalConfirmed.textContent = "—";
      elements.totalEntered.textContent = "—";
      elements.totalWaiting.textContent = "—";
      return;
    }

    const total = state.guests.length;
    const entered = state.guests.filter(guest => guest.entrou).length;

    elements.totalConfirmed.textContent = total;
    elements.totalEntered.textContent = entered;
    elements.totalWaiting.textContent = Math.max(0, total - entered);
  }

  function render() {
    updateMetrics();

    const guests = getFilteredGuests();

    elements.resultCount.textContent =
      `${guests.length} ${guests.length === 1 ? "nome" : "nomes"}`;

    const titles = {
      all: "Todos os convidados",
      waiting: "Aguardando entrada",
      entered: "Convidados que já entraram"
    };

    elements.listTitle.textContent = titles[state.filter] || titles.all;

    if (!guests.length) {
      setView("empty");
      return;
    }

    let currentLetter = "";
    const html = [];

    guests.forEach(guest => {
      const displayName = formatPersonName(guest.nome);
      const displayGroup = formatPersonName(guest.grupo);
      const letter = (normalize(displayName)[0] || "#").toUpperCase();

      if (letter !== currentLetter) {
        currentLetter = letter;
        html.push(`<div class="alpha-heading">${escapeHtml(letter)}</div>`);
      }

      const enteredAt = guest.horarioEntrada
        ? `Entrada às ${formatTime(guest.horarioEntrada)}`
        : "";

      const groupLabel =
        guest.grupo && normalize(guest.grupo) !== normalize(guest.nome)
          ? `Acompanhante de ${escapeHtml(displayGroup)}`
          : "";

      const saving = state.savingIds.has(guest.id);

      const actionArea = guest.entrou
        ? `
          <div class="entry-actions">
            <div class="entry-status-pill" aria-label="Entrada registrada">
              <span class="entry-status-icon" aria-hidden="true">✓</span>
              <span>Já entrou</span>
            </div>

            <button
              class="undo-entry-button"
              type="button"
              data-cancel-id="${escapeHtml(guest.id)}"
              aria-label="Desfazer entrada de ${escapeHtml(displayName)}"
            >
              <span class="undo-entry-icon" aria-hidden="true">↶</span>
              <span>Desfazer entrada</span>
            </button>
          </div>
        `
        : `
          <button
            class="checkin-button"
            type="button"
            data-enter-id="${escapeHtml(guest.id)}"
          >
            Liberar entrada
          </button>
        `;

      html.push(`
        <article
          class="guest-card ${guest.entrou ? "entered" : ""} ${saving ? "is-syncing-entry" : ""}"
          data-id="${escapeHtml(guest.id)}"
        >
          <div class="guest-main">
            <div class="guest-avatar" aria-hidden="true">
              ${escapeHtml(initials(displayName))}
            </div>

            <div class="guest-info">
              <h3 class="guest-name">${escapeHtml(displayName)}</h3>

              ${
                groupLabel || enteredAt
                  ? `
                    <div class="guest-meta">
                      ${groupLabel ? `<span>${groupLabel}</span>` : ""}
                      ${
                        groupLabel && enteredAt
                          ? `<span class="meta-separator"></span>`
                          : ""
                      }
                      ${enteredAt ? `<span>${escapeHtml(enteredAt)}</span>` : ""}
                    </div>
                  `
                  : ""
              }
            </div>
          </div>

          ${actionArea}
        </article>
      `);
    });

    elements.guestList.innerHTML = html.join("");
    setView("list");

    $$("[data-enter-id]").forEach(button => {
      button.addEventListener("click", () => {
        const guest = state.guests.find(g => g.id === button.dataset.enterId);
        if (!guest) return;
        requestCheckinState(guest, true);
      });
    });

    $$("[data-cancel-id]").forEach(button => {
      button.addEventListener("click", () => {
        const guest = state.guests.find(g => g.id === button.dataset.cancelId);
        if (!guest) return;
        openUndoDialog(guest);
      });
    });
  }

  async function loadGuests({ silent = false, sync = false } = {}) {
    if (state.loadPromise) {
      return state.loadPromise;
    }

    if (!API_URL) {
      if (!state.guests.length) setView("error");
      elements.errorMessage.textContent =
        "A URL do Google Apps Script ainda não foi configurada em config.js.";
      return;
    }

    if (!silent && !state.guests.length) {
      setView("loading");
    }

    setSyncing(sync ? "Atualizando a base de confirmações" : "Buscando dados atualizados");
    elements.refresh.classList.add("spinning");

    state.loadPromise = (async () => {
      try {
        const data = await jsonpRequest(
          { action: sync ? "sync" : "list" },
          sync ? 30000 : 25000
        );

        if (!data || data.status !== "success" || !Array.isArray(data.pessoas)) {
          throw new Error(data?.message || "Resposta inesperada do servidor.");
        }

        state.guests = mapPeople(data.pessoas);
        state.hasKnownList = true;
        state.consecutiveFailures = 0;
        saveCache();
        setOnline();
        render();
      } catch (error) {
        console.warn("Falha temporária na sincronização:", error);
        state.consecutiveFailures += 1;
        setConnectionProblem();

        // Nunca apaga uma lista válida por causa de uma falha temporária.
        if (state.hasKnownList) {
          render();
        } else {
          setView("error");
          elements.errorMessage.textContent =
            "O Google está demorando para responder. Tente novamente em alguns segundos.";
        }
      } finally {
        elements.refresh.classList.remove("spinning");
        state.loadPromise = null;
      }
    })();

    return state.loadPromise;
  }

  async function sendCheckin(id, entered) {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await jsonpRequest(
          {
            action: "checkin",
            id,
            entrou: entered ? "true" : "false"
          },
          25000
        );

        if (!data || data.status !== "success") {
          throw new Error(data?.message || "O Google não confirmou a alteração.");
        }

        return data;
      } catch (error) {
        lastError = error;

        if (attempt < 2) {
          await new Promise(resolve => window.setTimeout(resolve, 700));
        }
      }
    }

    throw lastError || new Error("Falha ao salvar o check-in.");
  }

  function requestCheckinState(guest, entered) {
    /*
     * A interface responde imediatamente.
     * Se o usuário clicar no sentido contrário enquanto o Google ainda salva,
     * guardamos a NOVA intenção e enviamos logo em seguida.
     */
    state.desiredCheckin.set(guest.id, Boolean(entered));

    guest.entrou = Boolean(entered);
    guest.horarioEntrada = entered ? new Date().toISOString() : "";

    saveCache();
    render();

    showToast(
      entered
        ? `Entrada de ${formatPersonName(guest.nome)} registrada.`
        : `Entrada de ${formatPersonName(guest.nome)} desfeita.`,
      "success"
    );

    flushCheckinQueue(guest.id);
  }

  async function flushCheckinQueue(id) {
    if (state.savingIds.has(id)) return;

    state.savingIds.add(id);
    render();

    try {
      while (state.desiredCheckin.has(id)) {
        const desired = state.desiredCheckin.get(id);
        state.desiredCheckin.delete(id);

        const result = await sendCheckin(id, desired);

        const guest = state.guests.find(g => String(g.id) === String(id));

        /*
         * Só aplica a resposta do servidor se o usuário não mudou de ideia
         * enquanto essa requisição estava em andamento.
         */
        if (guest && !state.desiredCheckin.has(id)) {
          guest.entrou = Boolean(result.entrou);
          guest.horarioEntrada = result.horarioEntrada || "";
          saveCache();
          render();
        }
      }

      state.consecutiveFailures = 0;
    } catch (error) {
      console.error("Falha ao salvar check-in:", error);

      showToast(
        "O Google não confirmou a alteração. Atualizando o status…",
        "error"
      );

      // Busca a verdade no servidor, mas sem apagar o que já temos se o Google estiver instável.
      await loadGuests({ silent: true });
    } finally {
      state.savingIds.delete(id);
      render();

      // Se houve novo clique exatamente durante o finally, processa também.
      if (state.desiredCheckin.has(id)) {
        flushCheckinQueue(id);
      }
    }
  }

  function openUndoDialog(guest) {
    state.undoTarget = guest;
    elements.confirmTitle.textContent =
      `Desfazer entrada de ${formatPersonName(guest.nome)}?`;
    elements.confirmText.textContent =
      "O nome voltará para a lista de aguardando. Essa alteração ficará salva para todos os aparelhos.";
    elements.confirmBackdrop.classList.remove("hidden");
  }

  function closeUndoDialog() {
    state.undoTarget = null;
    elements.confirmBackdrop.classList.add("hidden");
  }

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    render();
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    state.query = "";
    elements.search.focus();
    render();
  });

  $$(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      state.filter = tab.dataset.filter;

      $$(".filter-tab").forEach(item =>
        item.classList.toggle("active", item === tab)
      );

      render();
    });
  });

  elements.refresh.addEventListener("click", () => loadGuests({ sync: true }));
  elements.retry.addEventListener("click", () => loadGuests({ sync: true }));

  elements.cancelDialog.addEventListener("click", closeUndoDialog);

  elements.confirmBackdrop.addEventListener("click", event => {
    if (event.target === elements.confirmBackdrop) closeUndoDialog();
  });

  elements.confirmDialog.addEventListener("click", () => {
    if (!state.undoTarget) return;

    const guest = state.undoTarget;
    closeUndoDialog();
    requestCheckinState(guest, false);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeUndoDialog();
  });

  function startAutoRefresh() {
    window.clearInterval(state.refreshTimer);

    state.refreshTimer = window.setInterval(() => {
      if (!document.hidden && !state.loadPromise) {
        loadGuests({ silent: true });
      }
    }, Math.max(30000, AUTO_REFRESH_MS));
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.loadPromise) {
      loadGuests({ silent: true });
    }
  });

  /*
   * Primeiro mostra a última lista conhecida, se existir.
   * Depois sincroniza silenciosamente com o Google.
   */
  const restored = restoreCache();

  if (!restored) {
    updateMetrics();
    setSyncing();
  }

  loadGuests({ silent: restored });
  startAutoRefresh();
})();
