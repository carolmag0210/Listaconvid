/* v6 — check-in instantâneo + acompanhante identificado sem rótulo no principal */
(() => {
  "use strict";

  const CONFIG = window.PORTARIA_CONFIG || {};
  const API_URL = CONFIG.API_URL || "";
  const AUTO_REFRESH_MS = Number(CONFIG.AUTO_REFRESH_MS || 30000);

  const state = {
    guests: [],
    filter: "all",
    query: "",
    busyIds: new Set(),
    undoTarget: null,
    refreshTimer: null
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

  function updateConnection(online, label, detail) {
    elements.connectionDot.classList.toggle("online", !!online);
    elements.connectionDot.classList.toggle("offline", !online);
    elements.connectionLabel.textContent = label;
    elements.lastSyncLabel.textContent = detail;
  }

  function setView(view) {
    elements.loading.classList.toggle("hidden", view !== "loading");
    elements.error.classList.toggle("hidden", view !== "error");
    elements.empty.classList.toggle("hidden", view !== "empty");
    elements.guestList.classList.toggle("hidden", view !== "list");
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


  function jsonpList(action = "list") {
    return new Promise((resolve, reject) => {
      if (!API_URL) {
        reject(new Error("API_URL não configurada."));
        return;
      }

      const callbackName = `__lucieneLista_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Tempo esgotado ao carregar a lista."));
      }, 10000);

      function cleanup() {
        window.clearTimeout(timeout);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        script.remove();
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      const url = new URL(API_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", Date.now());

      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Falha ao carregar a lista pelo Google Apps Script."));
      };

      document.head.appendChild(script);
    });
  }

  function getFilteredGuests() {
    const q = normalize(state.query);

    return state.guests.filter((guest) => {
      const matchesSearch = !q || normalize(guest.nome).includes(q);

      let matchesFilter = true;
      if (state.filter === "entered") matchesFilter = !!guest.entrou;
      if (state.filter === "waiting") matchesFilter = !guest.entrou;

      return matchesSearch && matchesFilter;
    });
  }

  function updateMetrics() {
    const total = state.guests.length;
    const entered = state.guests.filter(g => g.entrou).length;

    elements.totalConfirmed.textContent = total;
    elements.totalEntered.textContent = entered;
    elements.totalWaiting.textContent = Math.max(0, total - entered);
  }

  function render() {
    updateMetrics();

    const guests = getFilteredGuests();
    elements.resultCount.textContent = `${guests.length} ${guests.length === 1 ? "nome" : "nomes"}`;

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

    guests.forEach((guest) => {
      const letter = (normalize(guest.nome)[0] || "#").toUpperCase();

      if (letter !== currentLetter) {
        currentLetter = letter;
        html.push(`<div class="alpha-heading">${escapeHtml(letter)}</div>`);
      }

      const busy = state.busyIds.has(guest.id);
      const enteredAt = guest.horarioEntrada ? `Entrada às ${formatTime(guest.horarioEntrada)}` : "";
      const groupLabel = guest.grupo && normalize(guest.grupo) !== normalize(guest.nome)
        ? `Acompanhante de ${escapeHtml(guest.grupo)}`
        : "";

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
              aria-label="Desfazer entrada de ${escapeHtml(guest.nome)}"
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
        <article class="guest-card ${guest.entrou ? "entered" : ""}" data-id="${escapeHtml(guest.id)}">
          <div class="guest-main">
            <div class="guest-avatar" aria-hidden="true">${escapeHtml(initials(guest.nome))}</div>

            <div class="guest-info">
              <h3 class="guest-name">${escapeHtml(guest.nome)}</h3>

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
        if (!guest || state.busyIds.has(guest.id)) return;
        saveCheckin(guest, true);
      });
    });

    $$("[data-cancel-id]").forEach(button => {
      button.addEventListener("click", () => {
        const guest = state.guests.find(g => g.id === button.dataset.cancelId);
        if (!guest || state.busyIds.has(guest.id)) return;
        openUndoDialog(guest);
      });
    });
  }

  async function loadGuests({ silent = false, sync = false } = {}) {
    if (!API_URL) {
      setView("error");
      elements.errorMessage.textContent = "A URL do Google Apps Script ainda não foi configurada em config.js.";
      updateConnection(false, "Configuração pendente", "Defina a URL da API");
      return;
    }

    if (!silent) setView("loading");
    elements.refresh.classList.add("spinning");

    try {
      const data = await jsonpList(sync ? "sync" : "list");

      if (!data || data.status !== "success" || !Array.isArray(data.pessoas)) {
        throw new Error(data?.message || "Resposta inesperada do servidor.");
      }

      state.guests = data.pessoas
        .map(person => ({
          id: String(person.id),
          nome: String(person.nome || "").trim(),
          grupo: String(person.grupo || "").trim(),
          tipo: String(person.tipo || ""),
          entrou: Boolean(person.entrou),
          horarioEntrada: person.horarioEntrada || ""
        }))
        .filter(person => person.nome)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

      const now = new Date();
      updateConnection(
        true,
        "Lista sincronizada",
        `Atualizada às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      );

      render();
    } catch (error) {
      console.error(error);
      if (!silent || !state.guests.length) {
        setView("error");
        elements.errorMessage.textContent = "Não foi possível consultar o Google Apps Script. Verifique a implantação e a conexão.";
      }
      updateConnection(false, "Sem conexão", "A última lista carregada foi mantida");
      if (state.guests.length) render();
    } finally {
      elements.refresh.classList.remove("spinning");
    }
  }

  async function postCheckin(id, entrou) {
    const payload = JSON.stringify({
      action: "checkin",
      id,
      entrou
    });

    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors",
      body: payload
    });
  }

  async function verifyCheckinInBackground(id, expected) {
    const delays = [1800, 2200, 2600];

    for (const delay of delays) {
      await new Promise(resolve => window.setTimeout(resolve, delay));

      try {
        const data = await jsonpList();

        if (data?.status !== "success" || !Array.isArray(data.pessoas)) {
          continue;
        }

        const found = data.pessoas.find(
          person => String(person.id) === String(id)
        );

        if (!found) {
          continue;
        }

        if (Boolean(found.entrou) === Boolean(expected)) {
          const guest = state.guests.find(g => String(g.id) === String(id));

          if (guest) {
            guest.entrou = Boolean(found.entrou);
            guest.horarioEntrada = found.horarioEntrada || "";
          }

          render();
          return true;
        }
      } catch (error) {
        console.warn("Conferência silenciosa do check-in falhou:", error);
      }
    }

    showToast(
      "A alteração ainda não foi confirmada pelo Google. Atualizando a lista…",
      "error"
    );

    await loadGuests({ silent: true });
    return false;
  }

  function saveCheckin(guest, entered) {
    if (state.busyIds.has(guest.id)) return;

    const previous = {
      entrou: guest.entrou,
      horarioEntrada: guest.horarioEntrada
    };

    /*
     * Resposta otimista:
     * a portaria vê a alteração imediatamente.
     * O Google salva em segundo plano.
     */
    guest.entrou = entered;
    guest.horarioEntrada = entered ? new Date().toISOString() : "";
    state.busyIds.add(guest.id);

    render();

    showToast(
      entered
        ? `Entrada de ${guest.nome} registrada.`
        : `Entrada de ${guest.nome} desfeita.`,
      "success"
    );

    /*
     * Não aguardamos a confirmação do Google para liberar a interface.
     * Isso elimina a sensação de "Salvando..." na portaria.
     */
    postCheckin(guest.id, entered)
      .then(() => {
        state.busyIds.delete(guest.id);
        verifyCheckinInBackground(guest.id, entered);
      })
      .catch(async (error) => {
        console.error(error);

        state.busyIds.delete(guest.id);
        guest.entrou = previous.entrou;
        guest.horarioEntrada = previous.horarioEntrada;

        render();

        showToast(
          "Não foi possível enviar a alteração. Tente novamente.",
          "error"
        );

        await loadGuests({ silent: true });
      });
  }

  function openUndoDialog(guest) {
    state.undoTarget = guest;
    elements.confirmTitle.textContent = `Desfazer entrada de ${guest.nome}?`;
    elements.confirmText.textContent = "O nome voltará para a lista de aguardando. Essa alteração ficará salva para todos os aparelhos.";
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
      $$(".filter-tab").forEach(item => item.classList.toggle("active", item === tab));
      render();
    });
  });

  elements.refresh.addEventListener("click", () => loadGuests({ sync: true }));
  elements.retry.addEventListener("click", () => loadGuests({ sync: true }));

  elements.cancelDialog.addEventListener("click", closeUndoDialog);
  elements.confirmBackdrop.addEventListener("click", event => {
    if (event.target === elements.confirmBackdrop) closeUndoDialog();
  });

  elements.confirmDialog.addEventListener("click", async () => {
    if (!state.undoTarget) return;
    const guest = state.undoTarget;
    closeUndoDialog();
    await saveCheckin(guest, false);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeUndoDialog();
  });

  function startAutoRefresh() {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = window.setInterval(() => {
      if (!document.hidden && !state.busyIds.size) {
        loadGuests({ silent: true });
      }
    }, Math.max(10000, AUTO_REFRESH_MS));
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadGuests({ silent: true });
  });

  loadGuests();
  startAutoRefresh();
})();
