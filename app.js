const POKE_API_BASE = "https://pokeapi.co/api/v2";

const state = {
  pokemons: [],
  visiblePokemons: [],
  selectedPokemon: null,
  offset: 0,
  limit: 24,
  searchTerm: "",
  cache: new Map(),
  favorites: [],
  isLoading: false,
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  searchButton: document.getElementById("searchButton"),
  cardsGrid: document.getElementById("cardsGrid"),
  resultsCount: document.getElementById("resultsCount"),
  loadMoreButton: document.getElementById("loadMoreButton"),
  detailCard: document.getElementById("detailCard"),
  detailModal: document.getElementById("detailModal"),
  detailModalBackdrop: document.querySelector(".detail-modal-backdrop"),
  closeModalButton: document.getElementById("closeModalButton"),
  favoritesGrid: document.getElementById("favoritesGrid"),
  favoritesCount: document.getElementById("favoritesCount"),
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  state.favorites = loadFavorites();
  bindEvents();
  loadInitialPokemon();
  renderFavorites();
}

function bindEvents() {
  elements.searchButton.addEventListener("click", () => {
    void handleSearch({ openDetails: false });
  });
  elements.searchInput.addEventListener("input", debounce(() => {
    closeModal();
    void handleSearch({ openDetails: false });
  }, 250));
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSearch({ openDetails: true });
    }
  });
  elements.loadMoreButton.addEventListener("click", loadMorePokemon);
  elements.closeModalButton.addEventListener("click", closeModal);
  elements.detailModalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  elements.cardsGrid.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-action='favorite']");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(Number(favoriteButton.dataset.id));
      return;
    }

    const card = event.target.closest(".card");
    if (!card) return;

    const id = Number(card.dataset.id);
    void openPokemonById(id);
  });

  elements.cardsGrid.addEventListener("keydown", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = Number(card.dataset.id);
      void openPokemonById(id);
    }
  });

  elements.favoritesGrid.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-action='favorite']");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(Number(favoriteButton.dataset.id));
      return;
    }

    const card = event.target.closest(".favorite-card");
    if (!card) return;

    const id = Number(card.dataset.id);
    void openPokemonById(id);
  });

  elements.favoritesGrid.addEventListener("keydown", (event) => {
    const card = event.target.closest(".favorite-card");
    if (!card) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = Number(card.dataset.id);
      void openPokemonById(id);
    }
  });
}

async function loadInitialPokemon() {
  if (state.isLoading) return;
  setLoading(true);

  try {
    const page = await fetchPokemonPage(state.offset, state.limit);
    state.pokemons = page;
    state.visiblePokemons = page;
    renderCards(state.visiblePokemons);
    updateResultsCount(state.visiblePokemons.length);
    renderFavorites();

    if (state.visiblePokemons.length) {
      selectPokemon(state.visiblePokemons[0]);
    } else {
      renderEmptyDetail();
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function loadMorePokemon() {
  if (state.isLoading) return;

  setLoading(true);

  try {
    state.offset += state.limit;
    const page = await fetchPokemonPage(state.offset, state.limit);

    state.pokemons = [...state.pokemons, ...page];

    if (state.searchTerm) {
      state.visiblePokemons = filterPokemons(state.searchTerm);
    } else {
      state.visiblePokemons = state.pokemons;
    }

    renderCards(state.visiblePokemons);
    updateResultsCount(state.visiblePokemons.length);
    renderFavorites();

    if (!state.selectedPokemon && state.visiblePokemons.length) {
      selectPokemon(state.visiblePokemons[0]);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function fetchPokemonPage(offset, limit) {
  const url = `${POKE_API_BASE}/pokemon?limit=${limit}&offset=${offset}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("No se pudo cargar la lista de Pokémon.");
  }

  const data = await response.json();
  const details = await Promise.all(data.results.map((item) => fetchPokemonDetail(item.name)));

  return details;
}

async function fetchPokemonDetail(nameOrId) {
  const cacheKey = String(nameOrId).toLowerCase();

  if (state.cache.has(cacheKey)) {
    return state.cache.get(cacheKey);
  }

  const [pokemonResponse, speciesResponse] = await Promise.all([
    fetch(`${POKE_API_BASE}/pokemon/${cacheKey}`).then(handleJsonResponse),
    fetch(`${POKE_API_BASE}/pokemon-species/${cacheKey}`).then(handleJsonResponse),
  ]);

  const typeDetails = await Promise.all(
    pokemonResponse.types.map((entry) =>
      fetch(`${POKE_API_BASE}/type/${entry.type.name}`).then(handleJsonResponse)
    )
  );

  const pokemon = normalizePokemon(pokemonResponse, speciesResponse, typeDetails);
  state.cache.set(cacheKey, pokemon);
  return pokemon;
}

function handleJsonResponse(response) {
  if (!response.ok) {
    throw new Error("No se pudo completar la petición a la PokéAPI.");
  }
  return response.json();
}

function normalizePokemon(pokemon, species, typeDetails = []) {
  const flavorEntry = species.flavor_text_entries.find((entry) => entry.language.name === "en");
  const description = flavorEntry
    ? flavorEntry.flavor_text.replace(/\f/g, " ").replace(/\s+/g, " ").trim()
    : "Este Pokémon aún no tiene una descripción disponible.";

  const habitat = species.habitat ? species.habitat.name : "Desconocido";
  const color = species.color ? species.color.name : "gray";

  const stats = pokemon.stats.map((entry) => ({
    name: formatStatName(entry.stat.name),
    value: entry.base_stat,
  }));

  const weaknesses = getWeaknessesFromTypeDetails(typeDetails);

  return {
    id: pokemon.id,
    name: pokemon.name,
    image:
      pokemon.sprites?.other?.["official-artwork"]?.front_default ||
      pokemon.sprites?.front_default ||
      "",
    types: pokemon.types.map((entry) => entry.type.name),
    height: (pokemon.height / 10).toFixed(1),
    weight: (pokemon.weight / 10).toFixed(1),
    abilities: pokemon.abilities.map((entry) => entry.ability.name).slice(0, 3),
    baseExperience: pokemon.base_experience,
    description,
    habitat,
    color,
    stats,
    weaknesses,
  };
}

function getWeaknessesFromTypeDetails(typeDetails) {
  const weaknesses = typeDetails.flatMap((type) =>
    type.damage_relations.double_damage_from.map((entry) => entry.name)
  );

  return [...new Set(weaknesses)].sort();
}

function formatStatName(name) {
  const mapping = {
    hp: "HP",
    attack: "Ataque",
    defense: "Defensa",
    "special-attack": "At. especial",
    "special-defense": "Def. especial",
    speed: "Velocidad",
  };

  return mapping[name] || name;
}

async function handleSearch(options = {}) {
  const { openDetails = false } = options;
  const query = elements.searchInput.value.trim().toLowerCase();
  state.searchTerm = query;

  if (!query) {
    state.visiblePokemons = state.pokemons;
    renderCards(state.visiblePokemons);
    updateResultsCount(state.visiblePokemons.length);

    if (openDetails && state.visiblePokemons.length) {
      const selected = state.visiblePokemons.find((item) => item.id === state.selectedPokemon?.id) || state.visiblePokemons[0];
      selectPokemon(selected);
    } else {
      renderEmptyDetail();
    }
    return;
  }

  const filtered = filterPokemons(query);
  if (filtered.length) {
    state.visiblePokemons = filtered;
    renderCards(filtered);
    updateResultsCount(filtered.length);

    if (openDetails) {
      const selected = filtered.find((item) => item.id === state.selectedPokemon?.id) || filtered[0];
      selectPokemon(selected);
    }
    return;
  }

  try {
    const pokemon = await fetchPokemonDetail(query);
    state.visiblePokemons = [pokemon];
    renderCards(state.visiblePokemons);
    updateResultsCount(1);
    if (openDetails) {
      selectPokemon(pokemon);
    }
  } catch (error) {
    showError(error.message);
  }
}

function filterPokemons(query) {
  return state.pokemons.filter((pokemon) => {
    const name = pokemon.name.toLowerCase();
    const id = String(pokemon.id);
    return name.includes(query) || id.includes(query);
  });
}

function renderCards(pokemons) {
  if (!pokemons.length) {
    elements.cardsGrid.innerHTML = `
      <div class="empty-state">
        No se encontraron resultados para tu búsqueda.
      </div>
    `;
    return;
  }

  elements.cardsGrid.innerHTML = pokemons
    .map((pokemon) => {
      const isActive = state.selectedPokemon?.id === pokemon.id;
      const isFavorite = state.favorites.includes(pokemon.id);

      return `
        <article class="card ${isActive ? "is-active" : ""}" data-id="${pokemon.id}" tabindex="0">
          <div class="card-head">
            <span class="card-id">#${String(pokemon.id).padStart(3, "0")}</span>
            <button
              class="favorite-toggle ${isFavorite ? "is-favorite" : ""}"
              type="button"
              data-action="favorite"
              data-id="${pokemon.id}"
              aria-pressed="${isFavorite}"
              aria-label="${isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}"
            >
              ${isFavorite ? "★" : "☆"}
            </button>
          </div>

          <img class="card-image" src="${pokemon.image}" alt="${pokemon.name}" loading="lazy" />

          <h3 class="card-name">${formatDisplayName(pokemon.name)}</h3>

          <div class="type-row">
            ${pokemon.types.map((type) => `<span class="type-badge type-${type}">${type}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function selectPokemon(pokemon) {
  if (!pokemon) return;

  addPokemonToCatalog(pokemon);
  state.selectedPokemon = pokemon;
  renderCards(state.visiblePokemons);
  renderDetail(pokemon);
  openModal();
}

function renderDetail(pokemon) {
  elements.detailCard.innerHTML = `
    <div class="detail-hero">
      <div class="detail-image-wrap">
        <img src="${pokemon.image}" alt="${pokemon.name}" />
      </div>

      <div>
        <p class="detail-number">#${String(pokemon.id).padStart(3, "0")}</p>
        <h3 class="detail-name">${formatDisplayName(pokemon.name)}</h3>

        <div class="type-row">
          ${pokemon.types.map((type) => `<span class="type-badge type-${type}">${type}</span>`).join("")}
        </div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-stat">
        <span>Altura</span>
        <strong>${pokemon.height} m</strong>
      </div>
      <div class="detail-stat">
        <span>Peso</span>
        <strong>${pokemon.weight} kg</strong>
      </div>
      <div class="detail-stat">
        <span>Experiencia base</span>
        <strong>${pokemon.baseExperience}</strong>
      </div>
      <div class="detail-stat">
        <span>Hábitat</span>
        <strong>${pokemon.habitat}</strong>
      </div>
    </div>

    <div class="detail-description">
      <h4>Descripción</h4>
      <p>${pokemon.description}</p>
    </div>

    <div class="detail-section">
      <h4>Debilidades</h4>
      ${pokemon.weaknesses.length ? `
        <div class="type-row">
          ${pokemon.weaknesses
            .map((type) => `<span class="type-badge type-${type}">${type}</span>`)
            .join("")}
        </div>
      ` : `<p>Sin debilidades registradas.</p>`}
    </div>

    <div class="detail-section">
      <h4>Estadísticas base</h4>
      <div class="stats-list">
        ${pokemon.stats
          .map(
            (stat) => `
              <div class="stat-row">
                <span>${stat.name}</span>
                <strong>${stat.value}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderEmptyDetail() {
  elements.detailCard.innerHTML = `
    <div class="detail-placeholder">
      <p>Selecciona un Pokémon para ver sus detalles y estadísticas.</p>
    </div>
  `;
}

function openModal() {
  elements.detailModal.classList.add("is-open");
  elements.detailModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal() {
  elements.detailModal.classList.remove("is-open");
  elements.detailModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function renderFavorites() {
  const favoritePokemons = getFavoritePokemons();

  elements.favoritesCount.textContent = favoritePokemons.length === 1 ? "1 favorito" : `${favoritePokemons.length} favoritos`;

  if (!favoritePokemons.length) {
    elements.favoritesGrid.innerHTML = `
      <div class="empty-state">
        Aún no tienes Pokémon favoritos.
      </div>
    `;
    return;
  }

  elements.favoritesGrid.innerHTML = favoritePokemons
    .map(
      (pokemon) => `
        <article class="favorite-card" data-id="${pokemon.id}" tabindex="0">
          <div class="favorite-top">
            <span class="card-id">#${String(pokemon.id).padStart(3, "0")}</span>
            <button
              class="favorite-toggle is-favorite"
              type="button"
              data-action="favorite"
              data-id="${pokemon.id}"
              aria-label="Quitar de favoritos"
            >
              ★
            </button>
          </div>

          <img class="card-image" src="${pokemon.image}" alt="${pokemon.name}" loading="lazy" />

          <h3 class="card-name">${formatDisplayName(pokemon.name)}</h3>
        </article>
      `
    )
    .join("");
}

function getFavoritePokemons() {
  return state.favorites.map((id) => findPokemonById(id)).filter(Boolean);
}

function findPokemonById(id) {
  const numericId = Number(id);
  return state.pokemons.find((pokemon) => pokemon.id === numericId) || Array.from(state.cache.values()).find((pokemon) => pokemon.id === numericId) || null;
}

function addPokemonToCatalog(pokemon) {
  if (!pokemon) return;

  const existingIndex = state.pokemons.findIndex((item) => item.id === pokemon.id);
  if (existingIndex >= 0) {
    state.pokemons[existingIndex] = pokemon;
  } else {
    state.pokemons = [pokemon, ...state.pokemons];
  }
}

async function openPokemonById(id) {
  const existing = findPokemonById(id);
  if (existing) {
    selectPokemon(existing);
    return;
  }

  try {
    const pokemon = await fetchPokemonDetail(id);
    selectPokemon(pokemon);
  } catch (error) {
    showError(error.message);
  }
}

function toggleFavorite(id) {
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter((favoriteId) => favoriteId !== id);
  } else {
    state.favorites = [...state.favorites, id].sort((a, b) => a - b);
  }

  saveFavorites();
  renderFavorites();
  renderCards(state.visiblePokemons);
}

function saveFavorites() {
  localStorage.setItem("pokedex-favorites", JSON.stringify(state.favorites));
}

function loadFavorites() {
  try {
    const saved = localStorage.getItem("pokedex-favorites");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function updateResultsCount(count) {
  const label = count === 1 ? "1 resultado" : `${count} resultados`;
  elements.resultsCount.textContent = label;
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.loadMoreButton.disabled = isLoading;
  elements.loadMoreButton.textContent = isLoading ? "Cargando..." : "Cargar más";
}

function showError(message) {
  elements.cardsGrid.innerHTML = `
    <div class="empty-state">
      ${message}
    </div>
  `;
  renderEmptyDetail();
}

function debounce(callback, delay) {
  let timeoutId;

  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback.apply(this, args);
    }, delay);
  };
}

function formatDisplayName(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
