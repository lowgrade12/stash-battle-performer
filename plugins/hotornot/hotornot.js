(function () {
  "use strict";

  // Current comparison pair and mode
  let currentPair = { left: null, right: null };
  let currentRanks = { left: null, right: null };
  let currentMode = "swiss"; // "swiss", "gauntlet", or "champion"
  let gauntletChampion = null; // The item currently on a winning streak (scene or performer)
  let gauntletWins = 0; // Current win streak
  let gauntletChampionRank = 0; // Current rank position (1 = top)
  let gauntletDefeated = []; // IDs of items defeated in current run
  let gauntletFalling = false; // True when champion lost and is finding their floor
  let gauntletFallingItem = null; // The item that's falling to find its position
  let totalItemsCount = 0; // Total items for position display
  let disableChoice = false; // Track when inputs should be disabled to prevent multiple events
  let battleType = "performers"; // HotOrNot is performers-only

  // ============================================
  // GRAPHQL QUERIES
  // ============================================

  async function graphqlQuery(query, variables = {}) {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors) {
      console.error("[HotOrNot] GraphQL error:", result.errors);
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  const SCENE_FRAGMENT = `
    id
    title
    date
    rating100
    paths {
      screenshot
      preview
    }
    files {
      duration
      path
    }
    studio {
      name
    }
    performers {
      name
    }
    tags {
      name
    }
  `;

  const PERFORMER_FRAGMENT = `
    id
    name
    image_path
    rating100
    birthdate
    ethnicity
    country
    gender
  `;

  const IMAGE_FRAGMENT = `
    id
    rating100
    paths {
      thumbnail
      image
    }
  `;

async function fetchSceneCount() {
    const countQuery = `
      query FindScenesCount {
        findScenes(filter: { per_page: 0 }) {
          count
        }
      }
    `;
    const countResult = await graphqlQuery(countQuery);
    return countResult.findScenes.count;
  }

  async function fetchRandomScenes(count = 2) {
    const totalScenes = await fetchSceneCount();
    
    if (totalScenes < 2) {
      throw new Error("Not enough scenes for comparison. You need at least 2 scenes.");
    }

    const scenesQuery = `
      query FindRandomScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
          scenes {
            ${SCENE_FRAGMENT}
          }
        }
      }
    `;

    const result = await graphqlQuery(scenesQuery, {
      filter: {
        per_page: Math.min(100, totalScenes),
        sort: "random"
      }
    });

    const allScenes = result.findScenes.scenes || [];
    
    if (allScenes.length < 2) {
      throw new Error("Not enough scenes returned from query.");
    }

    const shuffled = allScenes.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  }

  // Swiss mode: fetch two scenes with similar ratings
  async function fetchSwissPairScenes() {
    const scenesQuery = `
      query FindScenesByRating($filter: FindFilterType) {
        findScenes(filter: $filter) {
          scenes {
            ${SCENE_FRAGMENT}
          }
        }
      }
    `;

    // Get scenes sorted by rating
    const result = await graphqlQuery(scenesQuery, {
      filter: {
        per_page: -1, // Get all for accurate ranking
        sort: "rating",
        direction: "DESC"
      }
    });

    const scenes = result.findScenes.scenes || [];
    
    if (scenes.length < 2) {
      // Fallback to random if not enough rated scenes
      return { scenes: await fetchRandomScenes(2), ranks: [null, null] };
    }

    // Pick a random scene, then find one with similar rating
    const randomIndex = Math.floor(Math.random() * scenes.length);
    const scene1 = scenes[randomIndex];
    const rating1 = scene1.rating100 || 50;

    // Find scenes within ±15 rating points
    const similarScenes = scenes.filter(s => {
      if (s.id === scene1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= 15;
    });

    let scene2;
    let scene2Index;
    if (similarScenes.length > 0) {
      // Pick random from similar-rated scenes
      scene2 = similarScenes[Math.floor(Math.random() * similarScenes.length)];
      scene2Index = scenes.findIndex(s => s.id === scene2.id);
    } else {
      // No similar scenes, pick closest
      const otherScenes = scenes.filter(s => s.id !== scene1.id);
      otherScenes.sort((a, b) => {
        const diffA = Math.abs((a.rating100 || 50) - rating1);
        const diffB = Math.abs((b.rating100 || 50) - rating1);
        return diffA - diffB;
      });
      scene2 = otherScenes[0];
      scene2Index = scenes.findIndex(s => s.id === scene2.id);
    }

    return { 
      scenes: [scene1, scene2], 
      ranks: [randomIndex + 1, scene2Index + 1] 
    };
  }

  // Gauntlet mode: champion vs next challenger
  async function fetchGauntletPairScenes() {
    const scenesQuery = `
      query FindScenesByRating($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            ${SCENE_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL scenes sorted by rating descending (highest first)
    const result = await graphqlQuery(scenesQuery, {
      filter: {
        per_page: -1, // Get all
        sort: "rating",
        direction: "DESC"
      }
    });

    const scenes = result.findScenes.scenes || [];
    totalItemsCount = result.findScenes.count || scenes.length;
    
    if (scenes.length < 2) {
      return { scenes: await fetchRandomScenes(2), ranks: [null, null], isVictory: false, isFalling: false };
    }

    // Handle falling mode - find next opponent BELOW to test against
    if (gauntletFalling && gauntletFallingItem) {
      const fallingIndex = scenes.findIndex(s => s.id === gauntletFallingItem.id);
      
      // Find opponents below (higher index) that haven't been tested
      const belowOpponents = scenes.filter((s, idx) => {
        if (s.id === gauntletFallingItem.id) return false;
        if (gauntletDefeated.includes(s.id)) return false;
        return idx > fallingIndex; // Below in ranking
      });
      
      if (belowOpponents.length === 0) {
        // Hit the bottom - they're the lowest, place them here
        const finalRank = scenes.length;
        const finalRating = 1; // Lowest rating
        updateItemRating(gauntletFallingItem.id, finalRating);
        
        return {
          scenes: [gauntletFallingItem],
          ranks: [finalRank],
          isVictory: false,
          isFalling: true,
          isPlacement: true,
          placementRank: finalRank,
          placementRating: finalRating
        };
      } else {
        // Get next opponent below (first one, closest to falling scene)
        const nextBelow = belowOpponents[0];
        const nextBelowIndex = scenes.findIndex(s => s.id === nextBelow.id);
        
        // Update the falling scene's rank for display
        gauntletChampionRank = fallingIndex + 1;
        
        return {
          scenes: [gauntletFallingItem, nextBelow],
          ranks: [fallingIndex + 1, nextBelowIndex + 1],
          isVictory: false,
          isFalling: true
        };
      }
    }

    // If no champion yet, start with a random challenger vs the lowest rated scene
    if (!gauntletChampion) {
      // Reset state
      gauntletDefeated = [];
      gauntletFalling = false;
      gauntletFallingItem = null;
      
      // Pick random scene as challenger
      const randomIndex = Math.floor(Math.random() * scenes.length);
      const challenger = scenes[randomIndex];
      
      // Start at the bottom - find lowest rated scene that isn't the challenger
      const lowestRated = scenes
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = scenes.findIndex(s => s.id === lowestRated.id);
      
      // Challenger's current rank
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        scenes: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false,
        isFalling: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = scenes.findIndex(s => s.id === gauntletChampion.id);
    
    // Update champion rank (1-indexed, so +1)
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = scenes.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      // Only scenes ranked higher (lower index) or same rating
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has truly won
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        scenes: [gauntletChampion], 
        ranks: [1],
        isVictory: true,
        isFalling: false
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1]; // Closest to champion
    const nextOpponentIndex = scenes.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      scenes: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false,
      isFalling: false
    };
  }

  // Champion mode: like gauntlet but winner stays on (no falling)
  async function fetchChampionPairScenes() {
    const scenesQuery = `
      query FindScenesByRating($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            ${SCENE_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL scenes sorted by rating descending (highest first)
    const result = await graphqlQuery(scenesQuery, {
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    const scenes = result.findScenes.scenes || [];
    totalItemsCount = result.findScenes.count || scenes.length;
    
    if (scenes.length < 2) {
      return { scenes: await fetchRandomScenes(2), ranks: [null, null], isVictory: false };
    }

    // If no champion yet, start with a random challenger vs the lowest rated scene
    if (!gauntletChampion) {
      gauntletDefeated = [];
      
      // Pick random scene as challenger
      const randomIndex = Math.floor(Math.random() * scenes.length);
      const challenger = scenes[randomIndex];
      
      // Start at the bottom - find lowest rated scene that isn't the challenger
      const lowestRated = scenes
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = scenes.findIndex(s => s.id === lowestRated.id);
      
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        scenes: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = scenes.findIndex(s => s.id === gauntletChampion.id);
    
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = scenes.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has won!
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        scenes: [gauntletChampion], 
        ranks: [1],
        isVictory: true
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1];
    const nextOpponentIndex = scenes.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      scenes: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false
    };
  }
  
  function createVictoryScreen(champion) {
    // Handle scenes, performers, and images
    let title, imagePath;
    
    if (battleType === "performers") {
      // Performer
      title = champion.name || `Performer #${champion.id}`;
      imagePath = champion.image_path;
    } else if (battleType === "images") {
      // Image
      title = `Image #${champion.id}`;
      imagePath = champion.paths && champion.paths.thumbnail ? champion.paths.thumbnail : null;
    } else {
      // Scene
      const file = champion.files && champion.files[0] ? champion.files[0] : {};
      title = champion.title;
      if (!title && file.path) {
        const pathParts = file.path.split(/[/\\]/);
        title = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
      }
      if (!title) {
        title = `Scene #${champion.id}`;
      }
      imagePath = champion.paths ? champion.paths.screenshot : null;
    }
    
    const itemType = battleType === "performers" ? "performers" : (battleType === "images" ? "images" : "scenes");
    
    return `
      <div class="hon-victory-screen">
        <div class="hon-victory-crown">👑</div>
        <h2 class="hon-victory-title">CHAMPION!</h2>
        <div class="hon-victory-scene">
          ${imagePath 
            ? `<img class="hon-victory-image" src="${imagePath}" alt="${title}" />`
            : `<div class="hon-victory-image hon-no-image">No Image</div>`
          }
        </div>
        <h3 class="hon-victory-name">${title}</h3>
        <p class="hon-victory-stats">Conquered all ${totalItemsCount} ${itemType} with a ${gauntletWins} win streak!</p>
        <button id="hon-new-gauntlet" class="btn btn-primary">Start New Gauntlet</button>
      </div>
    `;
  }

  function showPlacementScreen(item, rank, finalRating) {
    const comparisonArea = document.getElementById("hon-comparison-area");
    if (!comparisonArea) return;
    
    // Handle scenes, performers, and images
    let title, imagePath;
    
    if (battleType === "performers") {
      // Performer
      title = item.name || `Performer #${item.id}`;
      imagePath = item.image_path;
    } else if (battleType === "images") {
      // Image
      title = `Image #${item.id}`;
      imagePath = item.paths && item.paths.thumbnail ? item.paths.thumbnail : null;
    } else {
      // Scene
      const file = item.files && item.files[0] ? item.files[0] : {};
      title = item.title;
      if (!title && file.path) {
        const pathParts = file.path.split(/[/\\]/);
        title = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
      }
      if (!title) {
        title = `Scene #${item.id}`;
      }
      imagePath = item.paths ? item.paths.screenshot : null;
    }
    
    comparisonArea.innerHTML = `
      <div class="hon-victory-screen">
        <div class="hon-victory-crown">📍</div>
        <h2 class="hon-victory-title">PLACED!</h2>
        <div class="hon-victory-scene">
          ${imagePath 
            ? `<img class="hon-victory-image" src="${imagePath}" alt="${title}" />`
            : `<div class="hon-victory-image hon-no-image">No Image</div>`
          }
        </div>
        <h3 class="hon-victory-name">${title}</h3>
        <p class="hon-victory-stats">
          Rank <strong>#${rank}</strong> of ${totalItemsCount}<br>
          Rating: <strong>${finalRating}/100</strong>
        </p>
        <button id="hon-new-gauntlet" class="btn btn-primary">Start New Run</button>
      </div>
    `;
    
    // Hide status and actions
    const statusEl = document.getElementById("hon-gauntlet-status");
    const actionsEl = document.querySelector(".hon-actions");
    if (statusEl) statusEl.style.display = "none";
    if (actionsEl) actionsEl.style.display = "none";
    
    // Reset state
    gauntletFalling = false;
    gauntletFallingItem = null;
    gauntletChampion = null;
    gauntletWins = 0;
    gauntletDefeated = [];
    
    // Attach button handler
    const newBtn = comparisonArea.querySelector("#hon-new-gauntlet");
    if (newBtn) {
      newBtn.addEventListener("click", () => {
        if (actionsEl) actionsEl.style.display = "";
        loadNewPair();
      });
    }
  }
  
  // Update scene rating in Stash database
  async function updateSceneRating(sceneId, rating100) {
    const mutation = `
      mutation SceneUpdate($input: SceneUpdateInput!) {
        sceneUpdate(input: $input) {
          id
          rating100
        }
      }
    `;
    
    try {
      await graphqlQuery(mutation, {
        input: {
          id: sceneId,
          rating100: Math.max(1, Math.min(100, rating100))
        }
      });
      console.log(`[HotOrNot] Updated scene ${sceneId} rating to ${rating100}`);
    } catch (e) {
      console.error(`[HotOrNot] Failed to update scene ${sceneId} rating:`, e);
    }
  }

  async function updatePerformerRating(performerId, newRating) {
    const mutation = `
      mutation PerformerUpdate($input: PerformerUpdateInput!) {
        performerUpdate(input: $input) {
          id
          rating100
        }
      }
    `;
  
    return await graphqlQuery(mutation, {
      input: {
        id: performerId,
        rating100: Math.round(newRating)
      }
    });
  }


  // ============================================
  // RATING LOGIC
  // ============================================

  function handleComparison(winnerId, loserId, winnerCurrentRating, loserCurrentRating, loserRank = null) {
    const winnerRating = winnerCurrentRating || 50;
    const loserRating = loserCurrentRating || 50;
    
    const ratingDiff = loserRating - winnerRating;
    
    let winnerGain = 0, loserLoss = 0;
    
    if (currentMode === "gauntlet" || currentMode === "champion") {
      // In gauntlet/champion, only the champion/falling scene changes rating
      // Defenders stay the same (they're just benchmarks)
      // EXCEPT: if the defender is rank #1, they lose 1 point when defeated
      const isChampionWinner = gauntletChampion && winnerId === gauntletChampion.id;
      const isFallingWinner = gauntletFalling && gauntletFallingItem && winnerId === gauntletFallingItem.id;
      const isChampionLoser = gauntletChampion && loserId === gauntletChampion.id;
      const isFallingLoser = gauntletFalling && gauntletFallingItem && loserId === gauntletFallingItem.id;
      
      const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
      const kFactor = 8;
      
      // Only the active scene (champion or falling) gets rating changes
      if (isChampionWinner || isFallingWinner) {
        winnerGain = Math.max(1, Math.round(kFactor * (1 - expectedWinner)));
      }
      if (isChampionLoser || isFallingLoser) {
        loserLoss = Math.max(1, Math.round(kFactor * expectedWinner));
      }
      
      // Special case: if defender was rank #1 and lost, drop their rating by 1
      if (loserRank === 1 && !isChampionLoser && !isFallingLoser) {
        loserLoss = 1;
      }
    } else {
      // Swiss mode: True ELO - both change based on expected outcome
      const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
      const kFactor = 8;
      
      winnerGain = Math.max(1, Math.round(kFactor * (1 - expectedWinner)));
      loserLoss = Math.max(1, Math.round(kFactor * expectedWinner));
    }
    
    const newWinnerRating = Math.min(100, Math.max(1, winnerRating + winnerGain));
    const newLoserRating = Math.min(100, Math.max(1, loserRating - loserLoss));
    
    const winnerChange = newWinnerRating - winnerRating;
    const loserChange = newLoserRating - loserRating;
    
    // Update items in Stash (only if changed)
    if (winnerChange !== 0) updateItemRating(winnerId, newWinnerRating);
    if (loserChange !== 0) updateItemRating(loserId, newLoserRating);
    
    return { newWinnerRating, newLoserRating, winnerChange, loserChange };
  }
  
  // Called when gauntlet champion loses - place them one below the winner
  function finalizeGauntletLoss(championId, winnerRating) {
    // Set champion rating to just below the scene that beat them
    const newRating = Math.max(1, winnerRating - 1);
    updateItemRating(championId, newRating);
    return newRating;
  }

  // ============================================
  // UI COMPONENTS
  // ============================================

  function formatDuration(seconds) {
    if (!seconds) return "N/A";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  }


  // ============================================
  // PERFORMER FUNCTIONS
  // ============================================

async function fetchPerformerCount(performerFilter = {}) {
    const countQuery = `
      query FindPerformers($performer_filter: PerformerFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: { per_page: 0 }) {
          count
        }
      }
    `;
    const countResult = await graphqlQuery(countQuery, { performer_filter: performerFilter });
    return countResult.findPerformers.count;
  }

  function getPerformerFilter() {
    const filter = {};
    // Exclude male performers
    filter.gender = {
      value: "MALE",
      modifier: "EXCLUDES"
    };
    // Exclude performers without images by filtering out those where image is missing
    filter.NOT = {
      is_missing: "image"
    };
    return filter;
  }

  async function fetchRandomPerformers(count = 2) {
  const performerFilter = getPerformerFilter();
  const totalPerformers = await fetchPerformerCount(performerFilter);
  if (totalPerformers < 2) {
    throw new Error("Not enough performers for comparison. You need at least 2 non-male performers with images.");
  }

  const performerQuery = `
    query FindRandomPerformers($performer_filter: PerformerFilterType, $filter: FindFilterType) {
      findPerformers(performer_filter: $performer_filter, filter: $filter) {
        performers {
          ${PERFORMER_FRAGMENT}
        }
      }
    }
  `;

  const result = await graphqlQuery(performerQuery, {
    performer_filter: performerFilter,
    filter: {
      per_page: Math.min(100, totalPerformers),
      sort: "random"
    }
  });

  const allPerformers = result.findPerformers.performers || [];
  
  if (allPerformers.length < 2) {
    throw new Error("Not enough performers for comparison. You need at least 2 performers.");
  }

  const shuffled = allPerformers.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

  // Swiss mode: fetch two performers with similar ratings
  async function fetchSwissPairPerformers() {
    const performerFilter = getPerformerFilter();
    const performersQuery = `
      query FindPerformersByRating($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          performers {
            ${PERFORMER_FRAGMENT}
          }
        }
      }
    `;

    // Get performers sorted by rating
    const result = await graphqlQuery(performersQuery, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1, // Get all for accurate ranking
        sort: "rating",
        direction: "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];
    
    if (performers.length < 2) {
      // Fallback to random if not enough rated performers
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }

    // Pick a random performer, then find one with similar rating
    const randomIndex = Math.floor(Math.random() * performers.length);
    const performer1 = performers[randomIndex];
    const rating1 = performer1.rating100 || 50;

    // Find performers within ±15 rating points
    const similarPerformers = performers.filter(s => {
      if (s.id === performer1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= 15;
    });

    let performer2;
    let performer2Index;
    if (similarPerformers.length > 0) {
      // Pick random from similar-rated performers
      performer2 = similarPerformers[Math.floor(Math.random() * similarPerformers.length)];
      performer2Index = performers.findIndex(s => s.id === performer2.id);
    } else {
      // No similar performers, pick closest
      const otherPerformers = performers.filter(s => s.id !== performer1.id);
      otherPerformers.sort((a, b) => {
        const diffA = Math.abs((a.rating100 || 50) - rating1);
        const diffB = Math.abs((b.rating100 || 50) - rating1);
        return diffA - diffB;
      });
      performer2 = otherPerformers[0];
      performer2Index = performers.findIndex(s => s.id === performer2.id);
    }

    return { 
      performers: [performer1, performer2], 
      ranks: [randomIndex + 1, performer2Index + 1] 
    };
  }

  // Gauntlet mode: champion vs next challenger
  async function fetchGauntletPairPerformers() {
    const performerFilter = getPerformerFilter();
    const performersQuery = `
      query FindPerformersByRating($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          count
          performers {
            ${PERFORMER_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL performers sorted by rating descending (highest first)
    const result = await graphqlQuery(performersQuery, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1, // Get all
        sort: "rating",
        direction: "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];
    totalItemsCount = performers.length;
    
    if (performers.length < 2) {
      return { performers: await fetchRandomPerformers(2), ranks: [null, null], isVictory: false, isFalling: false };
    }

    // Handle falling mode - find next opponent BELOW to test against
    if (gauntletFalling && gauntletFallingItem) {
      const fallingIndex = performers.findIndex(s => s.id === gauntletFallingItem.id);
      
      // Find opponents below (higher index) that haven't been tested
      const belowOpponents = performers.filter((s, idx) => {
        if (s.id === gauntletFallingItem.id) return false;
        if (gauntletDefeated.includes(s.id)) return false;
        return idx > fallingIndex; // Below in ranking
      });
      
      if (belowOpponents.length === 0) {
        // Hit the bottom - they're the lowest, place them here
        const finalRank = performers.length;
        const finalRating = 1; // Lowest rating
        updatePerformerRating(gauntletFallingItem.id, finalRating);
        
        return {
          performers: [gauntletFallingItem],
          ranks: [finalRank],
          isVictory: false,
          isFalling: true,
          isPlacement: true,
          placementRank: finalRank,
          placementRating: finalRating
        };
      } else {
        // Get next opponent below (first one, closest to falling performer)
        const nextBelow = belowOpponents[0];
        const nextBelowIndex = performers.findIndex(s => s.id === nextBelow.id);
        
        // Update the falling performer's rank for display
        gauntletChampionRank = fallingIndex + 1;
        
        return {
          performers: [gauntletFallingItem, nextBelow],
          ranks: [fallingIndex + 1, nextBelowIndex + 1],
          isVictory: false,
          isFalling: true
        };
      }
    }

    // If no champion yet, start with a random challenger vs the lowest rated performer
    if (!gauntletChampion) {
      // Reset state
      gauntletDefeated = [];
      gauntletFalling = false;
      gauntletFallingItem = null;
      
      // Pick random performer as challenger
      const randomIndex = Math.floor(Math.random() * performers.length);
      const challenger = performers[randomIndex];
      
      // Start at the bottom - find lowest rated performer that isn't the challenger
      const lowestRated = performers
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = performers.findIndex(s => s.id === lowestRated.id);
      
      // Challenger's current rank
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        performers: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false,
        isFalling: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = performers.findIndex(s => s.id === gauntletChampion.id);
    
    // Update champion rank (1-indexed, so +1)
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = performers.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      // Only performers ranked higher (lower index) or same rating
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has truly won
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        performers: [gauntletChampion], 
        ranks: [1],
        isVictory: true,
        isFalling: false
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1]; // Closest to champion
    const nextOpponentIndex = performers.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      performers: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false,
      isFalling: false
    };
  }

  // Champion mode: like gauntlet but winner stays on (no falling)
  async function fetchChampionPairPerformers() {
    const performerFilter = getPerformerFilter();
    const performersQuery = `
      query FindPerformersByRating($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          count
          performers {
            ${PERFORMER_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL performers sorted by rating descending (highest first)
    const result = await graphqlQuery(performersQuery, {
      performer_filter: performerFilter,
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];
    totalItemsCount = performers.length;
    
    if (performers.length < 2) {
      return { performers: await fetchRandomPerformers(2), ranks: [null, null], isVictory: false };
    }

    // If no champion yet, start with a random challenger vs the lowest rated performer
    if (!gauntletChampion) {
      gauntletDefeated = [];
      
      // Pick random performer as challenger
      const randomIndex = Math.floor(Math.random() * performers.length);
      const challenger = performers[randomIndex];
      
      // Start at the bottom - find lowest rated performer that isn't the challenger
      const lowestRated = performers
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = performers.findIndex(s => s.id === lowestRated.id);
      
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        performers: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = performers.findIndex(s => s.id === gauntletChampion.id);
    
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = performers.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has won!
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        performers: [gauntletChampion], 
        ranks: [1],
        isVictory: true
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1];
    const nextOpponentIndex = performers.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      performers: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false
    };
  }

  // ============================================
  // IMAGE FUNCTIONS
  // ============================================

  async function fetchImageCount() {
    const countQuery = `
      query FindImages {
        findImages(filter: { per_page: 0 }) {
          count
        }
      }
    `;
    const countResult = await graphqlQuery(countQuery);
    return countResult.findImages.count;
  }

  async function fetchRandomImages(count = 2) {
    const totalImages = await fetchImageCount();
    if (totalImages < 2) {
      throw new Error("Not enough images for comparison. You need at least 2 images.");
    }

    const imagesQuery = `
      query FindRandomImages($filter: FindFilterType) {
        findImages(filter: $filter) {
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: Math.min(100, totalImages),
        sort: "random"
      }
    });

    const allImages = result.findImages.images || [];
    
    if (allImages.length < 2) {
      throw new Error("Not enough images returned from query.");
    }

    const shuffled = allImages.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2);
  }

  // Swiss mode: fetch two images with similar ratings
  async function fetchSwissPairImages() {
    const imagesQuery = `
      query FindImagesByRating($filter: FindFilterType) {
        findImages(filter: $filter) {
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    // Get images sorted by rating
    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: -1, // Get all for accurate ranking
        sort: "rating",
        direction: "DESC"
      }
    });

    const images = result.findImages.images || [];
    
    if (images.length < 2) {
      // Fallback to random if not enough rated images
      return { images: await fetchRandomImages(2), ranks: [null, null] };
    }

    // Pick a random image, then find one with similar rating
    const randomIndex = Math.floor(Math.random() * images.length);
    const image1 = images[randomIndex];
    const rating1 = image1.rating100 || 50;

    // Find images within ±15 rating points
    const similarImages = images.filter(s => {
      if (s.id === image1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= 15;
    });

    let image2;
    let image2Index;
    if (similarImages.length > 0) {
      // Pick random from similar-rated images
      image2 = similarImages[Math.floor(Math.random() * similarImages.length)];
      image2Index = images.findIndex(s => s.id === image2.id);
    } else {
      // No similar images, pick closest
      const otherImages = images.filter(s => s.id !== image1.id);
      otherImages.sort((a, b) => {
        const diffA = Math.abs((a.rating100 || 50) - rating1);
        const diffB = Math.abs((b.rating100 || 50) - rating1);
        return diffA - diffB;
      });
      image2 = otherImages[0];
      image2Index = images.findIndex(s => s.id === image2.id);
    }

    return { 
      images: [image1, image2], 
      ranks: [randomIndex + 1, image2Index + 1] 
    };
  }

  // Gauntlet mode: champion vs next challenger
  async function fetchGauntletPairImages() {
    const imagesQuery = `
      query FindImagesByRating($filter: FindFilterType) {
        findImages(filter: $filter) {
          count
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL images sorted by rating descending (highest first)
    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: -1, // Get all
        sort: "rating",
        direction: "DESC"
      }
    });

    const images = result.findImages.images || [];
    totalItemsCount = images.length;
    
    if (images.length < 2) {
      return { images: await fetchRandomImages(2), ranks: [null, null], isVictory: false, isFalling: false };
    }

    // Handle falling mode - find next opponent BELOW to test against
    if (gauntletFalling && gauntletFallingItem) {
      const fallingIndex = images.findIndex(s => s.id === gauntletFallingItem.id);
      
      // Find opponents below (higher index) that haven't been tested
      const belowOpponents = images.filter((s, idx) => {
        if (s.id === gauntletFallingItem.id) return false;
        if (gauntletDefeated.includes(s.id)) return false;
        return idx > fallingIndex; // Below in ranking
      });
      
      if (belowOpponents.length === 0) {
        // Hit the bottom - they're the lowest, place them here
        const finalRank = images.length;
        const finalRating = 1; // Lowest rating
        updateImageRating(gauntletFallingItem.id, finalRating);
        
        return {
          images: [gauntletFallingItem],
          ranks: [finalRank],
          isVictory: false,
          isFalling: true,
          isPlacement: true,
          placementRank: finalRank,
          placementRating: finalRating
        };
      } else {
        // Get next opponent below (first one, closest to falling image)
        const nextBelow = belowOpponents[0];
        const nextBelowIndex = images.findIndex(s => s.id === nextBelow.id);
        
        // Update the falling image's rank for display
        gauntletChampionRank = fallingIndex + 1;
        
        return {
          images: [gauntletFallingItem, nextBelow],
          ranks: [fallingIndex + 1, nextBelowIndex + 1],
          isVictory: false,
          isFalling: true
        };
      }
    }

    // If no champion yet, start with a random challenger vs the lowest rated image
    if (!gauntletChampion) {
      // Reset state
      gauntletDefeated = [];
      gauntletFalling = false;
      gauntletFallingItem = null;
      
      // Pick random image as challenger
      const randomIndex = Math.floor(Math.random() * images.length);
      const challenger = images[randomIndex];
      
      // Start at the bottom - find lowest rated image that isn't the challenger
      const lowestRated = images
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = images.findIndex(s => s.id === lowestRated.id);
      
      // Challenger's current rank
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        images: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false,
        isFalling: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = images.findIndex(s => s.id === gauntletChampion.id);
    
    // Update champion rank (1-indexed, so +1)
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = images.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      // Only images ranked higher (lower index) or same rating
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has truly won
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        images: [gauntletChampion], 
        ranks: [1],
        isVictory: true,
        isFalling: false
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1]; // Closest to champion
    const nextOpponentIndex = images.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      images: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false,
      isFalling: false
    };
  }

  // Champion mode: like gauntlet but winner stays on (no falling)
  async function fetchChampionPairImages() {
    const imagesQuery = `
      query FindImagesByRating($filter: FindFilterType) {
        findImages(filter: $filter) {
          count
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    // Get ALL images sorted by rating descending (highest first)
    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: -1,
        sort: "rating",
        direction: "DESC"
      }
    });

    const images = result.findImages.images || [];
    totalItemsCount = images.length;
    
    if (images.length < 2) {
      return { images: await fetchRandomImages(2), ranks: [null, null], isVictory: false };
    }

    // If no champion yet, start with a random challenger vs the lowest rated image
    if (!gauntletChampion) {
      gauntletDefeated = [];
      
      // Pick random image as challenger
      const randomIndex = Math.floor(Math.random() * images.length);
      const challenger = images[randomIndex];
      
      // Start at the bottom - find lowest rated image that isn't the challenger
      const lowestRated = images
        .filter(s => s.id !== challenger.id)
        .sort((a, b) => (a.rating100 || 0) - (b.rating100 || 0))[0];
      
      const lowestIndex = images.findIndex(s => s.id === lowestRated.id);
      
      gauntletChampionRank = randomIndex + 1;
      
      return { 
        images: [challenger, lowestRated], 
        ranks: [randomIndex + 1, lowestIndex + 1],
        isVictory: false
      };
    }

    // Champion exists - find next opponent they haven't defeated yet
    const championIndex = images.findIndex(s => s.id === gauntletChampion.id);
    
    gauntletChampionRank = championIndex + 1;
    
    // Find opponents above champion that haven't been defeated
    const remainingOpponents = images.filter((s, idx) => {
      if (s.id === gauntletChampion.id) return false;
      if (gauntletDefeated.includes(s.id)) return false;
      return idx < championIndex || (s.rating100 || 0) >= (gauntletChampion.rating100 || 0);
    });
    
    // If no opponents left, champion has won!
    if (remainingOpponents.length === 0) {
      gauntletChampionRank = 1;
      return { 
        images: [gauntletChampion], 
        ranks: [1],
        isVictory: true
      };
    }
    
    // Pick the next highest-ranked remaining opponent
    const nextOpponent = remainingOpponents[remainingOpponents.length - 1];
    const nextOpponentIndex = images.findIndex(s => s.id === nextOpponent.id);
    
    return { 
      images: [gauntletChampion, nextOpponent], 
      ranks: [championIndex + 1, nextOpponentIndex + 1],
      isVictory: false
    };
  }

  async function updateImageRating(imageId, newRating) {
    const mutation = `
      mutation ImageUpdate($input: ImageUpdateInput!) {
        imageUpdate(input: $input) {
          id
          rating100
        }
      }
    `;
    
    try {
      await graphqlQuery(mutation, {
        input: {
          id: imageId,
          rating100: Math.max(1, Math.min(100, Math.round(newRating)))
        }
      });
      console.log(`[HotOrNot] Updated image ${imageId} rating to ${newRating}`);
    } catch (e) {
      console.error(`[HotOrNot] Failed to update image ${imageId} rating:`, e);
    }
  }

  // ============================================
  // WRAPPER FUNCTIONS (Dispatch based on battleType)
  // ============================================

  async function fetchSwissPair() {
    if (battleType === "performers") {
      return await fetchSwissPairPerformers();
    } else if (battleType === "images") {
      return await fetchSwissPairImages();
    } else {
      return await fetchSwissPairScenes();
    }
  }

  async function fetchGauntletPair() {
    if (battleType === "performers") {
      return await fetchGauntletPairPerformers();
    } else if (battleType === "images") {
      return await fetchGauntletPairImages();
    } else {
      return await fetchGauntletPairScenes();
    }
  }

  async function fetchChampionPair() {
    if (battleType === "performers") {
      return await fetchChampionPairPerformers();
    } else if (battleType === "images") {
      return await fetchChampionPairImages();
    } else {
      return await fetchChampionPairScenes();
    }
  }

  async function updateItemRating(itemId, newRating) {
    if (battleType === "performers") {
      return await updatePerformerRating(itemId, newRating);
    } else if (battleType === "images") {
      return await updateImageRating(itemId, newRating);
    } else {
      return await updateSceneRating(itemId, newRating);
    }
  }

  // UI COMPONENTS
  // ============================================

  

  function createSceneCard(scene, side, rank = null, streak = null) {
    const file = scene.files && scene.files[0] ? scene.files[0] : {};
    const duration = file.duration;
    const performers = scene.performers && scene.performers.length > 0 
      ? scene.performers.map((p) => p.name).join(", ") 
      : "No performers";
    const studio = scene.studio ? scene.studio.name : "No studio";
    const tags = scene.tags ? scene.tags.slice(0, 5).map((t) => t.name) : [];
    
    // Title fallback: title -> filename from path -> Scene ID
    let title = scene.title;
    if (!title && file.path) {
      const pathParts = file.path.split(/[/\\]/);
      title = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
    }
    if (!title) {
      title = `Scene #${scene.id}`;
    }
    
    const screenshotPath = scene.paths ? scene.paths.screenshot : null;
    const previewPath = scene.paths ? scene.paths.preview : null;
    const stashRating = scene.rating100 ? `${scene.rating100}/100` : "Unrated";
    
    // Handle numeric ranks and string ranks
    let rankDisplay = '';
    if (rank !== null && rank !== undefined) {
      if (typeof rank === 'number') {
        rankDisplay = `<span class="hon-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="hon-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge for gauntlet champion
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="hon-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="hon-scene-card" data-scene-id="${scene.id}" data-side="${side}" data-rating="${scene.rating100 || 50}">
        <div class="hon-scene-image-container" data-scene-url="/scenes/${scene.id}">
          ${screenshotPath 
            ? `<img class="hon-scene-image" src="${screenshotPath}" alt="${title}" loading="lazy" />`
            : `<div class="hon-scene-image hon-no-image">No Screenshot</div>`
          }
          ${previewPath ? `<video class="hon-hover-preview" src="${previewPath}" loop playsinline></video>` : ''}
          <div class="hon-scene-duration">${formatDuration(duration)}</div>
          ${streakDisplay}
          <div class="hon-click-hint">Click to open scene</div>
        </div>
        
        <div class="hon-scene-body" data-winner="${scene.id}">
          <div class="hon-scene-info">
            <div class="hon-scene-title-row">
              <h3 class="hon-scene-title">${title}</h3>
              ${rankDisplay}
            </div>
            
            <div class="hon-scene-meta">
              <div class="hon-meta-item"><strong>Studio:</strong> ${studio}</div>
              <div class="hon-meta-item"><strong>Performers:</strong> ${performers}</div>
              <div class="hon-meta-item"><strong>Date:</strong> ${scene.date || '<span class="hon-none">None</span>'}</div>
              <div class="hon-meta-item"><strong>Rating:</strong> ${stashRating}</div>
              <div class="hon-meta-item hon-tags-row"><strong>Tags:</strong> ${tags.length > 0 ? tags.map((tag) => `<span class="hon-tag">${tag}</span>`).join("") : '<span class="hon-none">None</span>'}</div>
            </div>
          </div>
          
          <div class="hon-choose-btn">
            ✓ Choose This Scene
          </div>
        </div>
      </div>
    `;
  }

  function createPerformerCard(performer, side, rank = null, streak = null) {
    // Performer name
    const name = performer.name || `Performer #${performer.id}`;
    
    // Performer image - use their profile image
    const imagePath = performer.image_path || null;
    
    // Performer metadata
    const birthdate = performer.birthdate || null;
    const ethnicity = performer.ethnicity || null;
    const country = performer.country || null;
    const stashRating = performer.rating100 ? `${performer.rating100}/100` : "Unrated";
    
    // Handle numeric ranks and string ranks
    let rankDisplay = '';
    if (rank !== null && rank !== undefined) {
      if (typeof rank === 'number') {
        rankDisplay = `<span class="hon-performer-rank hon-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="hon-performer-rank hon-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge for gauntlet champion
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="hon-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="hon-performer-card hon-scene-card" data-performer-id="${performer.id}" data-side="${side}" data-rating="${performer.rating100 || 50}">
        <div class="hon-performer-image-container hon-scene-image-container" data-performer-url="/performers/${performer.id}">
          ${imagePath 
            ? `<img class="hon-performer-image hon-scene-image" src="${imagePath}" alt="${name}" loading="lazy" />`
            : `<div class="hon-performer-image hon-scene-image hon-no-image">No Image</div>`
          }
          ${streakDisplay}
          <div class="hon-click-hint">Click to open performer</div>
        </div>
        
        <div class="hon-performer-body hon-scene-body" data-winner="${performer.id}">
          <div class="hon-performer-info hon-scene-info">
            <div class="hon-performer-title-row hon-scene-title-row">
              <h3 class="hon-performer-title hon-scene-title">${name}</h3>
              ${rankDisplay}
            </div>
            
            <div class="hon-performer-meta hon-scene-meta">
              ${birthdate ? `<div class="hon-meta-item"><strong>Birthdate:</strong> ${birthdate}</div>` : ''}
              ${ethnicity ? `<div class="hon-meta-item"><strong>Ethnicity:</strong> ${ethnicity}</div>` : ''}
              ${country ? `<div class="hon-meta-item"><strong>Country:</strong> ${country}</div>` : ''}
              <div class="hon-meta-item"><strong>Rating:</strong> ${stashRating}</div>
            </div>
          </div>
          
          <div class="hon-choose-btn">
            ✓ Choose This Performer
          </div>
        </div>
      </div>
    `;
  }

  function createImageCard(image, side, rank = null, streak = null) {
    // Image paths
    const imagePath = image.paths && image.paths.image ? image.paths.image : null;
    const thumbnailPath = image.paths && image.paths.thumbnail ? image.paths.thumbnail : null;
    
    // Handle numeric ranks and string ranks
    let rankDisplay = '';
    if (rank !== null && rank !== undefined) {
      if (typeof rank === 'number') {
        rankDisplay = `<span class="hon-image-rank hon-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="hon-image-rank hon-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge for gauntlet champion
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="hon-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="hon-image-card hon-scene-card" data-image-id="${image.id}" data-side="${side}" data-rating="${image.rating100 || 50}">
        <div class="hon-image-image-container hon-scene-image-container" data-image-url="/images/${image.id}">
          ${thumbnailPath 
            ? `<img class="hon-image-image hon-scene-image" src="${thumbnailPath}" alt="Image #${image.id}" loading="lazy" />`
            : `<div class="hon-image-image hon-scene-image hon-no-image">No Image</div>`
          }
          ${streakDisplay}
          ${rankDisplay ? `<div class="hon-image-rank-overlay">${rankDisplay}</div>` : ''}
          <div class="hon-click-hint">Click to open image</div>
        </div>
        
        <div class="hon-image-body hon-scene-body" data-winner="${image.id}">
          <div class="hon-choose-btn">
            ✓ Choose This Image
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // PERFORMER SELECTION FOR GAUNTLET
  // ============================================

  async function fetchPerformersForSelection(count = 5) {
    const performerFilter = getPerformerFilter();
    const totalPerformers = await fetchPerformerCount(performerFilter);
    
    if (totalPerformers < count) {
      count = totalPerformers;
    }

    const performerQuery = `
      query FindRandomPerformers($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          performers {
            ${PERFORMER_FRAGMENT}
          }
        }
      }
    `;

    const result = await graphqlQuery(performerQuery, {
      performer_filter: performerFilter,
      filter: {
        per_page: Math.min(100, totalPerformers),
        sort: "random"
      }
    });

    const allPerformers = result.findPerformers.performers || [];
    const shuffled = allPerformers.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  function createPerformerSelectionCard(performer) {
    const name = performer.name || `Performer #${performer.id}`;
    const imagePath = performer.image_path || null;
    const rating = performer.rating100 ? `${performer.rating100}/100` : "Unrated";
    
    return `
      <div class="hon-selection-card" data-performer-id="${performer.id}">
        <div class="hon-selection-image-container">
          ${imagePath 
            ? `<img class="hon-selection-image" src="${imagePath}" alt="${name}" loading="lazy" />`
            : `<div class="hon-selection-image hon-no-image">No Image</div>`
          }
        </div>
        <div class="hon-selection-info">
          <h4 class="hon-selection-name">${name}</h4>
          <div class="hon-selection-rating">${rating}</div>
        </div>
      </div>
    `;
  }

  async function loadPerformerSelection() {
    const selectionContainer = document.getElementById("hon-performer-selection");
    const performerList = document.getElementById("hon-performer-list");
    
    if (!selectionContainer || !performerList) return;

    try {
      const performers = await fetchPerformersForSelection(5);
      
      if (performers.length === 0) {
        performerList.innerHTML = '<div class="hon-error">No performers available for selection.</div>';
        return;
      }

      performerList.innerHTML = performers.map(p => createPerformerSelectionCard(p)).join('');
      
      // Attach click handlers
      performerList.querySelectorAll('.hon-selection-card').forEach((card) => {
        card.addEventListener('click', () => {
          const performerId = card.dataset.performerId;
          const selectedPerformer = performers.find(p => p.id.toString() === performerId);
          if (selectedPerformer) {
            startGauntletWithPerformer(selectedPerformer);
          }
        });
      });
    } catch (error) {
      console.error("[HotOrNot] Error loading performer selection:", error);
      performerList.innerHTML = `<div class="hon-error">Error loading performers: ${error.message}</div>`;
    }
  }

  function startGauntletWithPerformer(performer) {
    // Set the selected performer as the gauntlet champion
    gauntletChampion = performer;
    gauntletWins = 0;
    gauntletDefeated = [];
    gauntletFalling = false;
    gauntletFallingItem = null;
    
    // Hide the selection UI
    const selectionContainer = document.getElementById("hon-performer-selection");
    if (selectionContainer) {
      selectionContainer.style.display = "none";
    }
    
    // Show the comparison area and actions
    const comparisonArea = document.getElementById("hon-comparison-area");
    const actionsEl = document.querySelector(".hon-actions");
    if (comparisonArea) comparisonArea.style.display = "";
    if (actionsEl) actionsEl.style.display = "";
    
    // Load the first matchup
    loadNewPair();
  }

  function showPerformerSelection() {
    const selectionContainer = document.getElementById("hon-performer-selection");
    if (selectionContainer) {
      selectionContainer.style.display = "block";
      loadPerformerSelection();
    }
    
    // Hide the comparison area until a performer is selected
    const comparisonArea = document.getElementById("hon-comparison-area");
    const actionsEl = document.querySelector(".hon-actions");
    if (comparisonArea) comparisonArea.style.display = "none";
    if (actionsEl) actionsEl.style.display = "none";
  }

  function hidePerformerSelection() {
    const selectionContainer = document.getElementById("hon-performer-selection");
    if (selectionContainer) {
      selectionContainer.style.display = "none";
    }
    
    // Show the comparison area
    const comparisonArea = document.getElementById("hon-comparison-area");
    const actionsEl = document.querySelector(".hon-actions");
    if (comparisonArea) comparisonArea.style.display = "";
    if (actionsEl) actionsEl.style.display = "";
  }

  function createMainUI() {
    const itemType = battleType === "performers" ? "performers" : (battleType === "images" ? "images" : "scenes");
    const itemTypeSingular = battleType === "performers" ? "performer" : (battleType === "images" ? "image" : "scene");
    
    return `
      <div id="hotornot-container" class="hon-container">
        <div class="hon-header">
          <h1 class="hon-title">🔥 HotOrNot</h1>
          <p class="hon-subtitle">Compare ${itemType} head-to-head to build your rankings</p>
          
          <div class="hon-mode-toggle">
            <button class="hon-mode-btn ${currentMode === 'swiss' ? 'active' : ''}" data-mode="swiss">
              <span class="hon-mode-icon">⚖️</span>
              <span class="hon-mode-title">Swiss</span>
              <span class="hon-mode-desc">Fair matchups</span>
            </button>
            <button class="hon-mode-btn ${currentMode === 'gauntlet' ? 'active' : ''}" data-mode="gauntlet">
              <span class="hon-mode-icon">🎯</span>
              <span class="hon-mode-title">Gauntlet</span>
              <span class="hon-mode-desc">Place a ${itemTypeSingular}</span>
            </button>
            <button class="hon-mode-btn ${currentMode === 'champion' ? 'active' : ''}" data-mode="champion">
              <span class="hon-mode-icon">🏆</span>
              <span class="hon-mode-title">Champion</span>
              <span class="hon-mode-desc">Winner stays on</span>
            </button>
          </div>
        </div>

        <div id="hon-performer-selection" class="hon-performer-selection" style="display: none;">
          <h3 class="hon-selection-title">Select a ${itemTypeSingular} to run the gauntlet:</h3>
          <div id="hon-performer-list" class="hon-performer-list">
            <div class="hon-loading">Loading ${itemType}...</div>
          </div>
        </div>

        <div class="hon-content">
          <div id="hon-comparison-area" class="hon-comparison-area">
            <div class="hon-loading">Loading...</div>
          </div>
          <div class="hon-actions">
            <button id="hon-skip-btn" class="btn btn-secondary">Skip (Get New Pair)</button>
            <div class="hon-keyboard-hint">
              <span>← Left Arrow</span> to choose left · 
              <span>→ Right Arrow</span> to choose right · 
              <span>Space</span> to skip
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  async function loadNewPair() {
    disableChoice = false;
    const comparisonArea = document.getElementById("hon-comparison-area");
    if (!comparisonArea) return;

    // For gauntlet mode with performers, show selection if no champion yet
    if (currentMode === "gauntlet" && battleType === "performers" && !gauntletChampion && !gauntletFalling) {
      showPerformerSelection();
      return;
    }

    // Only show loading on first load (when empty or already showing loading)
    if (!comparisonArea.querySelector('.hon-vs-container')) {
      comparisonArea.innerHTML = '<div class="hon-loading">Loading...</div>';
    }

    try {
      let items;
      let ranks = [null, null];
      
      if (currentMode === "gauntlet") {
        const gauntletResult = await fetchGauntletPair();
        
        // Check for victory (champion reached #1)
        if (gauntletResult.isVictory) {
          comparisonArea.innerHTML = createVictoryScreen((gauntletResult.scenes || gauntletResult.performers || gauntletResult.images)[0]);
          
          // Hide the status banner and skip button
          const statusEl = document.getElementById("hon-gauntlet-status");
          const actionsEl = document.querySelector(".hon-actions");
          if (statusEl) statusEl.style.display = "none";
          if (actionsEl) actionsEl.style.display = "none";
          
          // Attach new gauntlet button
          const newGauntletBtn = comparisonArea.querySelector("#hon-new-gauntlet");
          if (newGauntletBtn) {
            newGauntletBtn.addEventListener("click", () => {
              gauntletChampion = null;
              gauntletWins = 0;
              gauntletChampionRank = 0;
              gauntletDefeated = [];
              gauntletFalling = false;
              gauntletFallingItem = null;
              // Show the actions again
              if (actionsEl) actionsEl.style.display = "";
              loadNewPair();
            });
          }
          
          return;
        }
        
        // Check for placement (falling scene hit bottom)
        if (gauntletResult.isPlacement) {
          showPlacementScreen((gauntletResult.scenes || gauntletResult.performers || gauntletResult.images)[0], gauntletResult.placementRank, gauntletResult.placementRating);
          return;
        }
        
        items = gauntletResult.scenes || gauntletResult.performers || gauntletResult.images;
        ranks = gauntletResult.ranks;
      } else if (currentMode === "champion") {
        const championResult = await fetchChampionPair();
        
        // Check for victory (champion beat everyone)
        if (championResult.isVictory) {
          comparisonArea.innerHTML = createVictoryScreen((championResult.scenes || championResult.performers || championResult.images)[0]);
          
          // Hide the skip button
          const actionsEl = document.querySelector(".hon-actions");
          if (actionsEl) actionsEl.style.display = "none";
          
          // Attach new run button
          const newGauntletBtn = comparisonArea.querySelector("#hon-new-gauntlet");
          if (newGauntletBtn) {
            newGauntletBtn.addEventListener("click", () => {
              gauntletChampion = null;
              gauntletWins = 0;
              gauntletChampionRank = 0;
              gauntletDefeated = [];
              if (actionsEl) actionsEl.style.display = "";
              loadNewPair();
            });
          }
          
          return;
        }
        
        items = championResult.scenes || championResult.performers || championResult.images;
        ranks = championResult.ranks;
      } else {
        const swissResult = await fetchSwissPair();
        items = swissResult.scenes || swissResult.performers || swissResult.images;
        ranks = swissResult.ranks;
      }
      
      if (items.length < 2) {
        const itemType = battleType === "performers" ? "performers" : (battleType === "images" ? "images" : "scenes");
        comparisonArea.innerHTML =
          `<div class="hon-error">Not enough ${itemType} available for comparison.</div>`;
        return;
      }

      currentPair.left = items[0];
      currentPair.right = items[1];
      currentRanks.left = ranks[0];
      currentRanks.right = ranks[1];

      // Determine streak for each card (gauntlet and champion modes)
      let leftStreak = null;
      let rightStreak = null;
      if (currentMode === "gauntlet" || currentMode === "champion") {
        if (gauntletChampion && items[0].id === gauntletChampion.id) {
          leftStreak = gauntletWins;
        } else if (gauntletChampion && items[1].id === gauntletChampion.id) {
          rightStreak = gauntletWins;
        }
      }

      comparisonArea.innerHTML = `
        <div class="hon-vs-container">
          ${(battleType === "performers" ? createPerformerCard : (battleType === "images" ? createImageCard : createSceneCard))(items[0], "left", ranks[0], leftStreak)}
          <div class="hon-vs-divider">
            <span class="hon-vs-text">VS</span>
          </div>
          ${(battleType === "performers" ? createPerformerCard : (battleType === "images" ? createImageCard : createSceneCard))(items[1], "right", ranks[1], rightStreak)}
        </div>
      `;

      // Attach event listeners to scene body (for choosing)
      comparisonArea.querySelectorAll(".hon-scene-body").forEach((body) => {
        body.addEventListener("click", handleChooseItem);
      });

      // Attach click-to-open (for thumbnail only)
      comparisonArea.querySelectorAll(".hon-scene-image-container").forEach((container) => {
        const itemUrl = container.dataset.sceneUrl || container.dataset.performerUrl || container.dataset.imageUrl;
        
        container.addEventListener("click", () => {
          if (itemUrl) {
            window.open(itemUrl, "_blank");
          }
        });
      });

      // Attach hover preview to entire card
      comparisonArea.querySelectorAll(".hon-scene-card").forEach((card) => {
        const video = card.querySelector(".hon-hover-preview");
        if (!video) return;
        
        card.addEventListener("mouseenter", () => {
          video.currentTime = 0;
          video.muted = false;
          video.volume = 0.5;
          video.play().catch(() => {});
        });
        
        card.addEventListener("mouseleave", () => {
          video.pause();
          video.currentTime = 0;
        });
      });
      
      // Update skip button state
      const skipBtn = document.querySelector("#hon-skip-btn");
      if (skipBtn) {
        const disableSkip = (currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion;
        skipBtn.disabled = disableSkip;
        skipBtn.style.opacity = disableSkip ? "0.5" : "1";
        skipBtn.style.cursor = disableSkip ? "not-allowed" : "pointer";
      }
    } catch (error) {
      console.error("[HotOrNot] Error loading scenes:", error);
      comparisonArea.innerHTML = `
        <div class="hon-error">
          Error loading scenes: ${error.message}<br>
          <button class="btn btn-primary" onclick="location.reload()">Retry</button>
        </div>
      `;
    }
  }

  function handleChooseItem(event) {
    if(disableChoice) return;
    disableChoice = true;
    const body = event.currentTarget;
    const winnerId = body.dataset.winner;
    const winnerCard = body.closest(".hon-scene-card");
    const loserId = winnerId === currentPair.left.id ? currentPair.right.id : currentPair.left.id;
    
    const winnerRating = parseInt(winnerCard.dataset.rating) || 50;
    const loserCard = document.querySelector(`.hon-scene-card[data-scene-id="${loserId}"], .hon-scene-card[data-performer-id="${loserId}"], .hon-scene-card[data-image-id="${loserId}"]`);
    const loserRating = parseInt(loserCard?.dataset.rating) || 50;
    
    // Get the loser's rank for #1 dethrone logic
    const loserRank = loserId === currentPair.left.id ? currentRanks.left : currentRanks.right;

    // Handle gauntlet mode (champion tracking)
    if (currentMode === "gauntlet") {
      const winnerItem = winnerId === currentPair.left.id ? currentPair.left : currentPair.right;
      const loserItem = loserId === currentPair.left.id ? currentPair.left : currentPair.right;
      
      // Check if we're in falling mode (finding floor after a loss)
      if (gauntletFalling && gauntletFallingItem) {
        if (winnerId === gauntletFallingItem.id) {
          // Falling scene won - found their floor!
          // Set their rating to just above the scene they beat
          const finalRating = Math.min(100, loserRating + 1);
          updateItemRating(gauntletFallingItem.id, finalRating);
          
          // Final rank is one above the opponent (we beat them, so we're above them)
          const opponentRank = loserId === currentPair.left.id ? currentRanks.left : currentRanks.right;
          const finalRank = Math.max(1, (opponentRank || 1) - 1);
          
          // Visual feedback
          winnerCard.classList.add("hon-winner");
          if (loserCard) loserCard.classList.add("hon-loser");
          
          // Show placement screen after brief delay
          setTimeout(() => {
            showPlacementScreen(gauntletFallingItem, finalRank, finalRating);
          }, 800);
          return;
        } else {
          // Falling scene lost again - keep falling
          gauntletDefeated.push(winnerId);
          
          // Visual feedback
          winnerCard.classList.add("hon-winner");
          if (loserCard) loserCard.classList.add("hon-loser");
          
          setTimeout(() => {
            loadNewPair();
          }, 800);
          return;
        }
      }
      
      // Normal climbing - calculate rating changes (pass loserRank for #1 dethrone)
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = handleComparison(winnerId, loserId, winnerRating, loserRating, loserRank);
      
      if (gauntletChampion && winnerId === gauntletChampion.id) {
        // Champion won - add loser to defeated list and continue climbing
        gauntletDefeated.push(loserId);
        gauntletWins++;
        gauntletChampion.rating100 = newWinnerRating;
      } else if (gauntletChampion && winnerId !== gauntletChampion.id) {
        // Champion LOST - start falling to find their floor
        gauntletFalling = true;
        gauntletFallingItem = loserItem; // The old champion is now falling
        gauntletDefeated = [winnerId]; // They lost to this scene
        
        // Winner becomes the new climbing champion
        gauntletChampion = winnerItem;
        gauntletChampion.rating100 = newWinnerRating;
        gauntletWins = 1;
      } else {
        // No champion yet - winner becomes champion
        gauntletChampion = winnerItem;
        gauntletChampion.rating100 = newWinnerRating;
        gauntletDefeated = [loserId];
        gauntletWins = 1;
      }
      
      // Visual feedback with animations
      winnerCard.classList.add("hon-winner");
      if (loserCard) loserCard.classList.add("hon-loser");
      
      showRatingAnimation(winnerCard, winnerRating, newWinnerRating, winnerChange, true);
      if (loserCard) {
        showRatingAnimation(loserCard, loserRating, newLoserRating, loserChange, false);
      }
      
      // Load new pair after animation
      setTimeout(() => {
        loadNewPair();
      }, 1500);
      return;
    }

    // Handle champion mode (like gauntlet but winner always takes over)
    if (currentMode === "champion") {
      const winnerItem = winnerId === currentPair.left.id ? currentPair.left : currentPair.right;
      
      // Calculate rating changes (pass loserRank for #1 dethrone)
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = handleComparison(winnerId, loserId, winnerRating, loserRating, loserRank);
      
      if (gauntletChampion && winnerId === gauntletChampion.id) {
        // Champion won - continue climbing
        gauntletDefeated.push(loserId);
        gauntletWins++;
        gauntletChampion.rating100 = newWinnerRating;
      } else {
        // Champion lost or first pick - winner becomes new champion
        gauntletChampion = winnerItem;
        gauntletChampion.rating100 = newWinnerRating;
        gauntletDefeated = [loserId];
        gauntletWins = 1;
      }
      
      // Visual feedback with animations
      winnerCard.classList.add("hon-winner");
      if (loserCard) loserCard.classList.add("hon-loser");
      
      showRatingAnimation(winnerCard, winnerRating, newWinnerRating, winnerChange, true);
      if (loserCard) {
        showRatingAnimation(loserCard, loserRating, newLoserRating, loserChange, false);
      }
      
      // Load new pair after animation
      setTimeout(() => {
        loadNewPair();
      }, 1500);
      return;
    }

    // For Swiss: Calculate and show rating changes
    const { newWinnerRating, newLoserRating, winnerChange, loserChange } = handleComparison(winnerId, loserId, winnerRating, loserRating);

    // Visual feedback
    winnerCard.classList.add("hon-winner");
    if (loserCard) loserCard.classList.add("hon-loser");

    // Show rating change animation
    showRatingAnimation(winnerCard, winnerRating, newWinnerRating, winnerChange, true);
    if (loserCard) {
      showRatingAnimation(loserCard, loserRating, newLoserRating, loserChange, false);
    }

    // Load new pair after animation
    setTimeout(() => {
      loadNewPair();
    }, 1500);
  }

  function showRatingAnimation(card, oldRating, newRating, change, isWinner) {
    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = `hon-rating-overlay ${isWinner ? 'hon-rating-winner' : 'hon-rating-loser'}`;
    
    const ratingDisplay = document.createElement("div");
    ratingDisplay.className = "hon-rating-display";
    ratingDisplay.textContent = oldRating;
    
    const changeDisplay = document.createElement("div");
    changeDisplay.className = "hon-rating-change";
    changeDisplay.textContent = isWinner ? `+${change}` : `${change}`;
    
    overlay.appendChild(ratingDisplay);
    overlay.appendChild(changeDisplay);
    card.appendChild(overlay);

    // Animate the rating counting
    let currentDisplay = oldRating;
    const step = isWinner ? 1 : -1;
    const totalSteps = Math.abs(change);
    let stepCount = 0;
    
    const interval = setInterval(() => {
      stepCount++;
      currentDisplay += step;
      ratingDisplay.textContent = currentDisplay;
      
      if (stepCount >= totalSteps) {
        clearInterval(interval);
        ratingDisplay.textContent = newRating;
      }
    }, 50);

    // Remove overlay after animation
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  }

  // ============================================
  // MODAL & NAVIGATION
  // ============================================

  function shouldShowButton() {
    const path = window.location.pathname;
    // Show on /performers or /images pages
    return (path === '/performers' || path === '/performers/' || path === '/images' || path === '/images/');
  }

function addFloatingButton() {
    const existingBtn = document.getElementById("hon-floating-btn");
    
    // Remove button if we're not on the performers page
    if (!shouldShowButton()) {
      if (existingBtn) existingBtn.remove();
      return;
    }
    
    // Don't add duplicate
    if (existingBtn) return;

    const btn = document.createElement("button");
    btn.id = "hon-floating-btn";
    btn.innerHTML = "🔥";
    btn.title = "HotOrNot";

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
      btn.style.boxShadow = "0 6px 20px rgba(13, 110, 253, 0.6)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 15px rgba(13, 110, 253, 0.4)";
    });

    btn.addEventListener("click", openRankingModal);

    document.body.appendChild(btn);
  }

  function openRankingModal() {
    // Detect if we're on performers or images page
    const path = window.location.pathname;
    if (path === '/images' || path === '/images/') {
      battleType = "images";
    } else {
      battleType = "performers";
    }
    
    const existingModal = document.getElementById("hon-modal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "hon-modal";
    modal.innerHTML = `
      <div class="hon-modal-backdrop"></div>
      <div class="hon-modal-content">
        <button class="hon-modal-close">✕</button>
        ${createMainUI()}
      </div>
    `;

    document.body.appendChild(modal);

    // Mode toggle buttons
    modal.querySelectorAll(".hon-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const newMode = btn.dataset.mode;
        if (newMode !== currentMode) {
          currentMode = newMode;
          
          // Reset gauntlet state when switching modes
          gauntletChampion = null;
          gauntletWins = 0;
          gauntletDefeated = [];
          gauntletFalling = false;
          gauntletFallingItem = null;
          
          // Update button states
          modal.querySelectorAll(".hon-mode-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === currentMode);
          });
          
          // Re-show actions (skip button) in case it was hidden
          const actionsEl = document.querySelector(".hon-actions");
          if (actionsEl) actionsEl.style.display = "";
          
          // Hide performer selection if not in gauntlet mode
          if (currentMode !== "gauntlet") {
            hidePerformerSelection();
          }
          
          // Load new pair in new mode
          loadNewPair();
        }
      });
    });

    // Skip button
    const skipBtn = modal.querySelector("#hon-skip-btn");
    if (skipBtn) {
      skipBtn.addEventListener("click", () => {
        // In gauntlet/champion mode with active run, skip is disabled
        if ((currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion) {
          return;
        }
        if(disableChoice) return
        disableChoice = true;
        // Reset state on skip
        if (currentMode === "gauntlet" || currentMode === "champion") {
          gauntletChampion = null;
          gauntletWins = 0;
          gauntletDefeated = [];
          gauntletFalling = false;
          gauntletFallingItem = null;
        }
        loadNewPair();
      });
    }

    // Load initial comparison
    loadNewPair();

    // Close handlers
    modal.querySelector(".hon-modal-backdrop").addEventListener("click", closeRankingModal);
    modal.querySelector(".hon-modal-close").addEventListener("click", closeRankingModal);
    
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeRankingModal();
        document.removeEventListener("keydown", escHandler);
      }
    });

    // Keyboard shortcuts for choosing
    document.addEventListener("keydown", function keyHandler(e) {
      const modal = document.getElementById("hon-modal");
      if (!modal) {
        document.removeEventListener("keydown", keyHandler);
        return;
      }

      if (e.key === "ArrowLeft" && currentPair.left) {
        const leftBody = modal.querySelector('.hon-scene-card[data-side="left"] .hon-scene-body');
        if (leftBody) leftBody.click();
      }
      if (e.key === "ArrowRight" && currentPair.right) {
        const rightBody = modal.querySelector('.hon-scene-card[data-side="right"] .hon-scene-body');
        if (rightBody) rightBody.click();
      }
      if (e.key === " " || e.code === "Space") {
        const activeElement = document.activeElement;
        if (activeElement.tagName !== "INPUT" && activeElement.tagName !== "TEXTAREA") {
          e.preventDefault();
          // Don't skip during active gauntlet/champion run
          if ((currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion) {
            return;
          }
          // TODO: Put these skip functionalities into ONE function
          if(disableChoice) return;
          disableChoice = true;
          if (currentMode === "gauntlet" || currentMode === "champion") {
            gauntletChampion = null;
            gauntletWins = 0;
            gauntletDefeated = [];
            gauntletFalling = false;
            gauntletFallingItem = null;
          }
          loadNewPair();
        }
      }
    });
  }

  function closeRankingModal() {
    const modal = document.getElementById("hon-modal");
    if (modal) modal.remove();
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log("[HotOrNot] Initialized");
    
    addFloatingButton();

    // Watch for SPA navigation
    const observer = new MutationObserver(() => {
      addFloatingButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();