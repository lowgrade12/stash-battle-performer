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
  let battleType = "scenes"; // "performers" or "scenes" - determined by current page

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
      console.error("[Stash Battle] GraphQL error:", result.errors);
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
    
    if (items.length < 2) {
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
    
    if (items.length < 2) {
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
        updateSceneRating(gauntletFallingItem.id, finalRating);
        
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
    
    if (items.length < 2) {
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
    // Handle both scenes and performers
    let title, imagePath;
    
    if (battleType === "performers") {
      // Performer
      title = champion.name || `Performer #${champion.id}`;
      imagePath = champion.image_path;
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
    
    const itemType = battleType === "performers" ? "performers" : "scenes";
    
    return `
      <div class="pwr-victory-screen">
        <div class="pwr-victory-crown">👑</div>
        <h2 class="pwr-victory-title">CHAMPION!</h2>
        <div class="pwr-victory-scene">
          ${imagePath 
            ? `<img class="pwr-victory-image" src="${imagePath}" alt="${title}" />`
            : `<div class="pwr-victory-image pwr-no-image">No Image</div>`
          }
        </div>
        <h3 class="pwr-victory-name">${title}</h3>
        <p class="pwr-victory-stats">Conquered all ${totalItemsCount} ${itemType} with a ${gauntletWins} win streak!</p>
        <button id="pwr-new-gauntlet" class="btn btn-primary">Start New Gauntlet</button>
      </div>
    `;
  }

  function showPlacementScreen(item, rank, finalRating) {
    const comparisonArea = document.getElementById("pwr-comparison-area");
    if (!comparisonArea) return;
    
    // Handle both scenes and performers
    let title, imagePath;
    
    if (battleType === "performers") {
      // Performer
      title = item.name || `Performer #${item.id}`;
      imagePath = item.image_path;
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
      <div class="pwr-victory-screen">
        <div class="pwr-victory-crown">📍</div>
        <h2 class="pwr-victory-title">PLACED!</h2>
        <div class="pwr-victory-scene">
          ${imagePath 
            ? `<img class="pwr-victory-image" src="${imagePath}" alt="${title}" />`
            : `<div class="pwr-victory-image pwr-no-image">No Image</div>`
          }
        </div>
        <h3 class="pwr-victory-name">${title}</h3>
        <p class="pwr-victory-stats">
          Rank <strong>#${rank}</strong> of ${totalItemsCount}<br>
          Rating: <strong>${finalRating}/100</strong>
        </p>
        <button id="pwr-new-gauntlet" class="btn btn-primary">Start New Run</button>
      </div>
    `;
    
    // Hide status and actions
    const statusEl = document.getElementById("pwr-gauntlet-status");
    const actionsEl = document.querySelector(".pwr-actions");
    if (statusEl) statusEl.style.display = "none";
    if (actionsEl) actionsEl.style.display = "none";
    
    // Reset state
    gauntletFalling = false;
    gauntletFallingItem = null;
    gauntletChampion = null;
    gauntletWins = 0;
    gauntletDefeated = [];
    
    // Attach button handler
    const newBtn = comparisonArea.querySelector("#pwr-new-gauntlet");
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
      console.log(`[Stash Battle] Updated scene ${sceneId} rating to ${rating100}`);
    } catch (e) {
      console.error(`[Stash Battle] Failed to update scene ${sceneId} rating:`, e);
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
    
    // Update scenes in Stash (only if changed)
    if (winnerChange !== 0) updateSceneRating(winnerId, newWinnerRating);
    if (loserChange !== 0) updateSceneRating(loserId, newLoserRating);
    
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
    return filter;
  }

 async function fetchRandomPerformers(count = 2) {
  const performerFilter = getPerformerFilter();
  const totalPerformers = await fetchPerformerCount(performerFilter);
  if (totalPerformers < 2) {
    throw new Error("Not enough performers for comparison. You need at least 2 non-male performers.");
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
    throw new Error("Not enough performers returned from query.");
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
    totalItemsCount = result.findPerformers.count || performers.length;
    
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
    totalItemsCount = result.findPerformers.count || performers.length;
    
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
  // WRAPPER FUNCTIONS (Dispatch based on battleType)
  // ============================================

  async function fetchSwissPair() {
    if (battleType === "performers") {
      return await fetchSwissPairPerformers();
    } else {
      return await fetchSwissPairScenes();
    }
  }

  async function fetchGauntletPair() {
    if (battleType === "performers") {
      return await fetchGauntletPairPerformers();
    } else {
      return await fetchGauntletPairScenes();
    }
  }

  async function fetchChampionPair() {
    if (battleType === "performers") {
      return await fetchChampionPairPerformers();
    } else {
      return await fetchChampionPairScenes();
    }
  }

  async function updateItemRating(itemId, newRating) {
    if (battleType === "performers") {
      return await updatePerformerRating(itemId, newRating);
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
        rankDisplay = `<span class="pwr-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="pwr-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge for gauntlet champion
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="pwr-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="pwr-scene-card" data-scene-id="${scene.id}" data-side="${side}" data-rating="${scene.rating100 || 50}">
        <div class="pwr-scene-image-container" data-scene-url="/scenes/${scene.id}">
          ${screenshotPath 
            ? `<img class="pwr-scene-image" src="${screenshotPath}" alt="${title}" loading="lazy" />`
            : `<div class="pwr-scene-image pwr-no-image">No Screenshot</div>`
          }
          ${previewPath ? `<video class="pwr-hover-preview" src="${previewPath}" loop playsinline></video>` : ''}
          <div class="pwr-scene-duration">${formatDuration(duration)}</div>
          ${streakDisplay}
          <div class="pwr-click-hint">Click to open scene</div>
        </div>
        
        <div class="pwr-scene-body" data-winner="${scene.id}">
          <div class="pwr-scene-info">
            <div class="pwr-scene-title-row">
              <h3 class="pwr-scene-title">${title}</h3>
              ${rankDisplay}
            </div>
            
            <div class="pwr-scene-meta">
              <div class="pwr-meta-item"><strong>Studio:</strong> ${studio}</div>
              <div class="pwr-meta-item"><strong>Performers:</strong> ${performers}</div>
              <div class="pwr-meta-item"><strong>Date:</strong> ${scene.date || '<span class="pwr-none">None</span>'}</div>
              <div class="pwr-meta-item"><strong>Rating:</strong> ${stashRating}</div>
              <div class="pwr-meta-item pwr-tags-row"><strong>Tags:</strong> ${tags.length > 0 ? tags.map((tag) => `<span class="pwr-tag">${tag}</span>`).join("") : '<span class="pwr-none">None</span>'}</div>
            </div>
          </div>
          
          <div class="pwr-choose-btn">
            ✓ Choose This Scene
          </div>
        </div>
      </div>
    `;
  }

  function createPerformerCard(performer, side, rank = null, streak = null) {
    // Performer name
    const name = performer.name || `Performer #${performer.id}`;
    
    // Performer image
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
        rankDisplay = `<span class="pwr-performer-rank pwr-scene-rank">#${rank}</span>`;
      } else {
        rankDisplay = `<span class="pwr-performer-rank pwr-scene-rank">${rank}</span>`;
      }
    }
    
    // Streak badge for gauntlet champion
    let streakDisplay = '';
    if (streak !== null && streak > 0) {
      streakDisplay = `<div class="pwr-streak-badge">🔥 ${streak} win${streak > 1 ? 's' : ''}</div>`;
    }

    return `
      <div class="pwr-performer-card pwr-scene-card" data-performer-id="${performer.id}" data-side="${side}" data-rating="${performer.rating100 || 50}">
        <div class="pwr-performer-image-container pwr-scene-image-container" data-performer-url="/performers/${performer.id}">
          ${imagePath 
            ? `<img class="pwr-performer-image pwr-scene-image" src="${imagePath}" alt="${name}" loading="lazy" />`
            : `<div class="pwr-performer-image pwr-scene-image pwr-no-image">No Image</div>`
          }
          ${streakDisplay}
          <div class="pwr-click-hint">Click to open performer</div>
        </div>
        
        <div class="pwr-performer-body pwr-scene-body" data-winner="${performer.id}">
          <div class="pwr-performer-info pwr-scene-info">
            <div class="pwr-performer-title-row pwr-scene-title-row">
              <h3 class="pwr-performer-title pwr-scene-title">${name}</h3>
              ${rankDisplay}
            </div>
            
            <div class="pwr-performer-meta pwr-scene-meta">
              ${birthdate ? `<div class="pwr-meta-item"><strong>Birthdate:</strong> ${birthdate}</div>` : ''}
              ${ethnicity ? `<div class="pwr-meta-item"><strong>Ethnicity:</strong> ${ethnicity}</div>` : ''}
              ${country ? `<div class="pwr-meta-item"><strong>Country:</strong> ${country}</div>` : ''}
              <div class="pwr-meta-item"><strong>Rating:</strong> ${stashRating}</div>
            </div>
          </div>
          
          <div class="pwr-choose-btn">
            ✓ Choose This Performer
          </div>
        </div>
      </div>
    `;
  }


  function createMainUI() {
    const itemType = battleType === "performers" ? "performers" : "scenes";
    const itemTypeSingular = battleType === "performers" ? "performer" : "scene";
    
    return `
      <div id="stash-battle-container" class="pwr-container">
        <div class="pwr-header">
          <h1 class="pwr-title">⚔️ Stash Battle</h1>
          <p class="pwr-subtitle">Compare ${itemType} head-to-head to build your rankings</p>
          
          <div class="pwr-mode-toggle">
            <button class="pwr-mode-btn ${currentMode === 'swiss' ? 'active' : ''}" data-mode="swiss">
              <span class="pwr-mode-icon">⚖️</span>
              <span class="pwr-mode-title">Swiss</span>
              <span class="pwr-mode-desc">Fair matchups</span>
            </button>
            <button class="pwr-mode-btn ${currentMode === 'gauntlet' ? 'active' : ''}" data-mode="gauntlet">
              <span class="pwr-mode-icon">🎯</span>
              <span class="pwr-mode-title">Gauntlet</span>
              <span class="pwr-mode-desc">Place a ${itemTypeSingular}</span>
            </button>
            <button class="pwr-mode-btn ${currentMode === 'champion' ? 'active' : ''}" data-mode="champion">
              <span class="pwr-mode-icon">🏆</span>
              <span class="pwr-mode-title">Champion</span>
              <span class="pwr-mode-desc">Winner stays on</span>
            </button>
          </div>
        </div>

        <div class="pwr-content">
          <div id="pwr-comparison-area" class="pwr-comparison-area">
            <div class="pwr-loading">Loading...</div>
          </div>
          <div class="pwr-actions">
            <button id="pwr-skip-btn" class="btn btn-secondary">Skip (Get New Pair)</button>
            <div class="pwr-keyboard-hint">
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
    const comparisonArea = document.getElementById("pwr-comparison-area");
    if (!comparisonArea) return;

    // Only show loading on first load (when empty or already showing loading)
    if (!comparisonArea.querySelector('.pwr-vs-container')) {
      comparisonArea.innerHTML = '<div class="pwr-loading">Loading...</div>';
    }

    try {
      let items;
      let ranks = [null, null];
      
      if (currentMode === "gauntlet") {
        const gauntletResult = await fetchGauntletPair();
        
        // Check for victory (champion reached #1)
        if (gauntletResult.isVictory) {
          comparisonArea.innerHTML = createVictoryScreen((gauntletResult.scenes || gauntletResult.performers)[0]);
          
          // Hide the status banner and skip button
          const statusEl = document.getElementById("pwr-gauntlet-status");
          const actionsEl = document.querySelector(".pwr-actions");
          if (statusEl) statusEl.style.display = "none";
          if (actionsEl) actionsEl.style.display = "none";
          
          // Attach new gauntlet button
          const newGauntletBtn = comparisonArea.querySelector("#pwr-new-gauntlet");
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
          showPlacementScreen((gauntletResult.scenes || gauntletResult.performers)[0], gauntletResult.placementRank, gauntletResult.placementRating);
          return;
        }
        
        const items = gauntletResult.scenes || gauntletResult.performers;
        ranks = gauntletResult.ranks;
      } else if (currentMode === "champion") {
        const championResult = await fetchChampionPair();
        
        // Check for victory (champion beat everyone)
        if (championResult.isVictory) {
          comparisonArea.innerHTML = createVictoryScreen((championResult.scenes || championResult.performers)[0]);
          
          // Hide the skip button
          const actionsEl = document.querySelector(".pwr-actions");
          if (actionsEl) actionsEl.style.display = "none";
          
          // Attach new run button
          const newGauntletBtn = comparisonArea.querySelector("#pwr-new-gauntlet");
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
        
        items = championResult.scenes || championResult.performers;
        ranks = championResult.ranks;
      } else {
        const swissResult = await fetchSwissPair();
        items = swissResult.scenes || swissResult.performers;
        ranks = swissResult.ranks;
      }
      
      if (items.length < 2) {
        comparisonArea.innerHTML =
          '<div class="pwr-error">Not enough scenes available for comparison.</div>';
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
        if (gauntletChampion && scenes[0].id === gauntletChampion.id) {
          leftStreak = gauntletWins;
        } else if (gauntletChampion && scenes[1].id === gauntletChampion.id) {
          rightStreak = gauntletWins;
        }
      }

      comparisonArea.innerHTML = `
        <div class="pwr-vs-container">
          ${(battleType === "performers" ? createPerformerCard : createSceneCard)(items[0], "left", ranks[0], leftStreak)}
          <div class="pwr-vs-divider">
            <span class="pwr-vs-text">VS</span>
          </div>
          ${(battleType === "performers" ? createPerformerCard : createSceneCard)(items[1], "right", ranks[1], rightStreak)}
        </div>
      `;

      // Attach event listeners to scene body (for choosing)
      comparisonArea.querySelectorAll(".pwr-scene-body").forEach((body) => {
        body.addEventListener("click", handleChooseItem);
      });

      // Attach click-to-open (for thumbnail only)
      comparisonArea.querySelectorAll(".pwr-scene-image-container").forEach((container) => {
        const sceneUrl = container.dataset.sceneUrl;
        
        container.addEventListener("click", () => {
          if (sceneUrl) {
            window.open(sceneUrl, "_blank");
          }
        });
      });

      // Attach hover preview to entire card
      comparisonArea.querySelectorAll(".pwr-scene-card").forEach((card) => {
        const video = card.querySelector(".pwr-hover-preview");
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
      const skipBtn = document.querySelector("#pwr-skip-btn");
      if (skipBtn) {
        const disableSkip = (currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion;
        skipBtn.disabled = disableSkip;
        skipBtn.style.opacity = disableSkip ? "0.5" : "1";
        skipBtn.style.cursor = disableSkip ? "not-allowed" : "pointer";
      }
    } catch (error) {
      console.error("[Stash Battle] Error loading scenes:", error);
      comparisonArea.innerHTML = `
        <div class="pwr-error">
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
    const winnerCard = body.closest(".pwr-scene-card");
    const loserId = winnerId === currentPair.left.id ? currentPair.right.id : currentPair.left.id;
    
    const winnerRating = parseInt(winnerCard.dataset.rating) || 50;
    const loserCard = document.querySelector(`.pwr-scene-card[data-scene-id="${loserId}"], .pwr-scene-card[data-performer-id="${loserId}"]`);
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
          winnerCard.classList.add("pwr-winner");
          if (loserCard) loserCard.classList.add("pwr-loser");
          
          // Show placement screen after brief delay
          setTimeout(() => {
            showPlacementScreen(gauntletFallingItem, finalRank, finalRating);
          }, 800);
          return;
        } else {
          // Falling scene lost again - keep falling
          gauntletDefeated.push(winnerId);
          
          // Visual feedback
          winnerCard.classList.add("pwr-winner");
          if (loserCard) loserCard.classList.add("pwr-loser");
          
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
      winnerCard.classList.add("pwr-winner");
      if (loserCard) loserCard.classList.add("pwr-loser");
      
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
      winnerCard.classList.add("pwr-winner");
      if (loserCard) loserCard.classList.add("pwr-loser");
      
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
    winnerCard.classList.add("pwr-winner");
    if (loserCard) loserCard.classList.add("pwr-loser");

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
    overlay.className = `pwr-rating-overlay ${isWinner ? 'pwr-rating-winner' : 'pwr-rating-loser'}`;
    
    const ratingDisplay = document.createElement("div");
    ratingDisplay.className = "pwr-rating-display";
    ratingDisplay.textContent = oldRating;
    
    const changeDisplay = document.createElement("div");
    changeDisplay.className = "pwr-rating-change";
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
    // Show on /scenes or /performers pages
    return (path === '/scenes' || path === '/scenes/' || path === '/performers' || path === '/performers/');
  }

function addFloatingButton() {
    const existingBtn = document.getElementById("pwr-floating-btn");
    
    // Remove button if we're not on the scenes page
    if (!shouldShowButton()) {
      if (existingBtn) existingBtn.remove();
      return;
    }
    
    // Don't add duplicate
    if (existingBtn) return;

    const btn = document.createElement("button");
    btn.id = "pwr-floating-btn";
    btn.innerHTML = "⚔️";
    btn.title = "Stash Battle";

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
    // Ensure battleType is set correctly for current page
    const path = window.location.pathname;
    if (path === '/performers' || path === '/performers/') {
      battleType = "performers";
    } else {
      battleType = "scenes";
    }
    
    const existingModal = document.getElementById("pwr-modal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "pwr-modal";
    modal.innerHTML = `
      <div class="pwr-modal-backdrop"></div>
      <div class="pwr-modal-content">
        <button class="pwr-modal-close">✕</button>
        ${createMainUI()}
      </div>
    `;

    document.body.appendChild(modal);

    // Mode toggle buttons
    modal.querySelectorAll(".pwr-mode-btn").forEach((btn) => {
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
          modal.querySelectorAll(".pwr-mode-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.mode === currentMode);
          });
          
          // Re-show actions (skip button) in case it was hidden
          const actionsEl = document.querySelector(".pwr-actions");
          if (actionsEl) actionsEl.style.display = "";
          
          // Load new pair in new mode
          loadNewPair();
        }
      });
    });

    // Skip button
    const skipBtn = modal.querySelector("#pwr-skip-btn");
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
    modal.querySelector(".pwr-modal-backdrop").addEventListener("click", closeRankingModal);
    modal.querySelector(".pwr-modal-close").addEventListener("click", closeRankingModal);
    
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeRankingModal();
        document.removeEventListener("keydown", escHandler);
      }
    });

    // Keyboard shortcuts for choosing
    document.addEventListener("keydown", function keyHandler(e) {
      const modal = document.getElementById("pwr-modal");
      if (!modal) {
        document.removeEventListener("keydown", keyHandler);
        return;
      }

      if (e.key === "ArrowLeft" && currentPair.left) {
        const leftBody = modal.querySelector('.pwr-scene-card[data-side="left"] .pwr-scene-body');
        if (leftBody) leftBody.click();
      }
      if (e.key === "ArrowRight" && currentPair.right) {
        const rightBody = modal.querySelector('.pwr-scene-card[data-side="right"] .pwr-scene-body');
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
    const modal = document.getElementById("pwr-modal");
    if (modal) modal.remove();
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log("[Stash Battle] Initialized");
    
    // Detect battle type based on current page
    const path = window.location.pathname;
    if (path === '/performers' || path === '/performers/') {
      battleType = "performers";
    } else {
      battleType = "scenes";
    }

    addFloatingButton();

    // Watch for SPA navigation
    const observer = new MutationObserver(() => {
      // Update battleType when page changes
      const currentPath = window.location.pathname;
      if (currentPath === '/performers' || currentPath === '/performers/') {
        battleType = "performers";
      } else if (currentPath === '/scenes' || currentPath === '/scenes/') {
        battleType = "scenes";
      }
      
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