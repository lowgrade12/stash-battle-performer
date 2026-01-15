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

  // Filter state for performers
  let performerFilters = {
    // High-value filters
    gender: {
      enabled: true,
      exclude: ["MALE"] // Exclude males by default
    },
    favorites: {
      enabled: false,
      onlyFavorites: true // true = only favorites, false = exclude favorites
    },
    tags: {
      enabled: false,
      tagIds: [], // Array of tag IDs to include
      mode: "INCLUDES" // "INCLUDES" or "EXCLUDES"
    },
    rating: {
      enabled: false,
      min: 1,
      max: 100
    },
    age: {
      enabled: false,
      min: 18,
      max: 99
    },
    // Physical attribute filters
    ethnicity: {
      enabled: false,
      value: "", // String value for ethnicity
      modifier: "INCLUDES" // "INCLUDES", "EXCLUDES", "IS_NULL", "NOT_NULL"
    },
    country: {
      enabled: false,
      value: "", // String value for country
      modifier: "INCLUDES"
    },
    height: {
      enabled: false,
      min: 140, // cm
      max: 200 // cm
    },
    eyeColor: {
      enabled: false,
      value: "",
      modifier: "INCLUDES"
    },
    hairColor: {
      enabled: false,
      value: "",
      modifier: "INCLUDES"
    },
    weight: {
      enabled: false,
      min: 40, // kg
      max: 150 // kg
    },
    // Always exclude performers without images
    excludeWithoutImage: true
  };

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
    details
    custom_fields
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

    // Find scenes within adaptive rating window (tighter for larger pools)
    const matchWindow = scenes.length > 50 ? 10 : scenes.length > 20 ? 15 : 25;
    const similarScenes = scenes.filter(s => {
      if (s.id === scene1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= matchWindow;
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
    
    // Pick the next highest-ranked remaining opponent with randomization
    const nextOpponent = selectRandomOpponent(remainingOpponents);
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
    
    // Pick the next highest-ranked remaining opponent with randomization
    const nextOpponent = selectRandomOpponent(remainingOpponents);
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

  async function updatePerformerRating(performerId, newRating, performerObj = null, won = null) {
    const mutation = `
      mutation UpdatePerformerCustomFields($id: ID!, $rating: Int!, $fields: Map) {
        performerUpdate(input: {
          id: $id,
          rating100: $rating,
          custom_fields: {
            partial: $fields
          }
        }) {
          id
          rating100
          custom_fields
        }
      }
    `;
  
    const variables = {
      id: performerId,
      rating: Math.round(newRating)
    };
    
    // Update stats if performer object provided (won can be true/false/null)
    // won=true: winner with full stats, won=false: loser with full stats, won=null: participation only (no win/loss)
    // Check for won !== undefined to handle all three cases (true, false, null)
    if (performerObj && battleType === "performers" && won !== undefined) {
      const currentStats = parsePerformerEloData(performerObj);
      
      // Update stats based on match outcome
      const newStats = updatePerformerStats(currentStats, won);
      
      // Save stats as JSON string in custom field
      variables.fields = {
        hotornot_stats: JSON.stringify(newStats)
      };
    }
    
    return await graphqlQuery(mutation, variables);
  }


  // ============================================
  // RATING LOGIC
  // ============================================

  /**
   * Select a random opponent from the closest remaining opponents
   * Assumes remainingOpponents array is in rank order (best first, closest to champion last)
   * @param {Array} remainingOpponents - Array of remaining opponents in rank order
   * @param {number} maxChoices - Maximum number of closest opponents to consider (default: 3)
   * @returns {Object|null} Randomly selected opponent from the closest options, or null if no opponents
   */
  function selectRandomOpponent(remainingOpponents, maxChoices = 3) {
    if (remainingOpponents.length === 0) return null;
    
    // Get up to maxChoices closest opponents from the end of the array
    const closestOpponents = remainingOpponents.slice(-maxChoices);
    return closestOpponents[Math.floor(Math.random() * closestOpponents.length)];
  }

  /**
   * Parse ELO match data from performer custom_fields
   * @param {Object} performer - Performer object from GraphQL
   * @returns {Object} stats - ELO statistics object with matches, wins, losses, etc.
   */
  function parsePerformerEloData(performer) {
    if (!performer || !performer.custom_fields) {
      return {
        total_matches: 0,
        wins: 0,
        losses: 0,
        current_streak: 0,
        best_streak: 0,
        worst_streak: 0,
        last_match: null
      };
    }
    
    // Check for Approach 2 stats (comprehensive tracking)
    if (performer.custom_fields.hotornot_stats) {
      try {
        const stats = JSON.parse(performer.custom_fields.hotornot_stats);
        return {
          total_matches: stats.total_matches || 0,
          wins: stats.wins || 0,
          losses: stats.losses || 0,
          current_streak: stats.current_streak || 0,
          best_streak: stats.best_streak || 0,
          worst_streak: stats.worst_streak || 0,
          last_match: stats.last_match || null
        };
      } catch (e) {
        console.warn(`[HotOrNot] Failed to parse hotornot_stats for performer ${performer.id}:`, e);
      }
    }
    
    // Fallback to Approach 1 (match count only) for backward compatibility
    const eloMatches = performer.custom_fields.elo_matches;
    if (eloMatches) {
      const matches = parseInt(eloMatches, 10);
      return {
        total_matches: isNaN(matches) ? 0 : matches,
        wins: 0,
        losses: 0,
        current_streak: 0,
        best_streak: 0,
        worst_streak: 0,
        last_match: null
      };
    }
    
    // No data - return empty stats
    return {
      total_matches: 0,
      wins: 0,
      losses: 0,
      current_streak: 0,
      best_streak: 0,
      worst_streak: 0,
      last_match: null
    };
  }

  /**
   * Update performer stats after a match
   * @param {Object} currentStats - Current stats object from parsePerformerEloData
   * @param {boolean|null} won - True if performer won, false if lost, null for participation-only (no win/loss tracking, gauntlet mode defenders only)
   * @returns {Object} Updated stats object
   */
  function updatePerformerStats(currentStats, won) {
    // Base stats that always update
    const newStats = {
      total_matches: currentStats.total_matches + 1,
      last_match: new Date().toISOString()
    };
    
    // If won is null, this is participation-only (gauntlet mode defender benchmark only)
    // Only increment match count and timestamp, don't track win/loss or streaks
    if (won === null) {
      newStats.wins = currentStats.wins;
      newStats.losses = currentStats.losses;
      newStats.current_streak = currentStats.current_streak;
      newStats.best_streak = currentStats.best_streak;
      newStats.worst_streak = currentStats.worst_streak;
      return newStats;
    }
    
    // Track win/loss
    newStats.wins = won ? currentStats.wins + 1 : currentStats.wins;
    newStats.losses = won ? currentStats.losses : currentStats.losses + 1;
    
    // Calculate current streak
    if (won) {
      // Win: increment positive streak or start new positive streak
      newStats.current_streak = currentStats.current_streak >= 0 
        ? currentStats.current_streak + 1 
        : 1;
    } else {
      // Loss: decrement negative streak or start new negative streak
      newStats.current_streak = currentStats.current_streak <= 0 
        ? currentStats.current_streak - 1 
        : -1;
    }
    
    // Update best/worst streaks
    if (newStats.current_streak > 0) {
      newStats.best_streak = Math.max(currentStats.best_streak, newStats.current_streak);
      newStats.worst_streak = currentStats.worst_streak;
    } else {
      newStats.best_streak = currentStats.best_streak;
      newStats.worst_streak = Math.min(currentStats.worst_streak, newStats.current_streak);
    }
    
    return newStats;
  }

  /**
   * Calculate K-factor based on match count (experience) and mode
   * @param {number} currentRating - Current ELO rating
   * @param {number} matchCount - Number of matches played
   * @param {string} mode - Current game mode ("swiss", "gauntlet", "champion")
   * @returns {number} K-factor value
   */
  function getKFactor(currentRating, matchCount = null, mode = "swiss") {
    let baseKFactor;
    
    // If match count is available, use it for more accurate K-factor
    if (matchCount !== null && matchCount !== undefined) {
      // New performers: High K-factor for fast convergence
      if (matchCount < 10) {
        baseKFactor = 16;
      }
      // Moderately established: Medium K-factor
      else if (matchCount < 30) {
        baseKFactor = 12;
      }
      // Well-established (30+ matches): Low K-factor for stability
      else {
        baseKFactor = 8;
      }
    } else {
      // Fallback to rating-based heuristic (legacy behavior)
      // Items near the default rating (50) are likely less established
      // Items far from 50 have likely had more comparisons
      const distanceFromDefault = Math.abs(currentRating - 50);
      
      if (distanceFromDefault < 10) {
        baseKFactor = 12;  // Higher K for unproven items near default
      } else if (distanceFromDefault < 25) {
        baseKFactor = 10;  // Medium K for moderately established items
      } else {
        baseKFactor = 8;   // Lower K for well-established items
      }
    }
    
    // Apply mode-specific multiplier
    // Champion mode: 0.5x K-factor (half the rating change of Swiss mode)
    // This allows ratings to update but at a much slower pace
    if (mode === "champion") {
      return Math.max(1, Math.round(baseKFactor * 0.5));
    }
    
    // Swiss and gauntlet modes use full K-factor
    return baseKFactor;
  }

  /**
   * Check if a performer is an active participant in gauntlet mode
   * Active participants are those whose stats should be tracked
   * Note: In champion mode, ALL participants are active (both get full stats)
   * @param {string} performerId - ID of the performer to check
   * @param {number|null} performerRank - Rank of the performer (null if not ranked)
   * @returns {boolean} True if performer's stats should be tracked
   */
  function isActiveParticipant(performerId, performerRank) {
    // In Swiss mode, all participants are active
    if (currentMode === "swiss") {
      return true;
    }
    
    // In Champion mode, all participants are active (both get full stats tracked)
    if (currentMode === "champion") {
      return true;
    }
    
    // In Gauntlet mode, only champion/falling performers are active
    if (currentMode === "gauntlet") {
      // Check if this is the champion
      const isChampion = gauntletChampion && performerId === gauntletChampion.id;
      
      // Check if this is the falling performer
      const isFalling = gauntletFalling && gauntletFallingItem && performerId === gauntletFallingItem.id;
      
      // Champion or falling performer are always active
      if (isChampion || isFalling) {
        return true;
      }
      
      // Defender at rank #1 who is being challenged is also active (they can lose rating)
      if (performerRank === 1) {
        return true;
      }
      
      // All other defenders are not active (they're just benchmarks)
      return false;
    }
    
    // Default: not active
    return false;
  }

  async function handleComparison(winnerId, loserId, winnerCurrentRating, loserCurrentRating, loserRank = null, winnerObj = null, loserObj = null) {
    const winnerRating = winnerCurrentRating || 50;
    const loserRating = loserCurrentRating || 50;
    
    const ratingDiff = loserRating - winnerRating;
    
    // Fetch fresh performer data to ensure we have current stats
    // This prevents stats from being overwritten when performers have consecutive matches
    let freshWinnerObj = winnerObj;
    let freshLoserObj = loserObj;
    
    if (battleType === "performers") {
      // Fetch both performers in parallel for better performance
      const [fetchedWinner, fetchedLoser] = await Promise.all([
        (winnerObj && winnerId) ? fetchPerformerById(winnerId) : Promise.resolve(null),
        (loserObj && loserId) ? fetchPerformerById(loserId) : Promise.resolve(null)
      ]);
      
      freshWinnerObj = fetchedWinner || winnerObj;
      freshLoserObj = fetchedLoser || loserObj;
    }
    
    // Parse match counts from custom fields (only for performers)
    let winnerMatchCount = null;
    let loserMatchCount = null;
    if (battleType === "performers" && freshWinnerObj) {
      const winnerStats = parsePerformerEloData(freshWinnerObj);
      winnerMatchCount = winnerStats.total_matches;
    }
    if (battleType === "performers" && freshLoserObj) {
      const loserStats = parsePerformerEloData(freshLoserObj);
      loserMatchCount = loserStats.total_matches;
    }
    
    let winnerGain = 0, loserLoss = 0;
    
    if (currentMode === "gauntlet") {
      // In gauntlet, only the champion/falling scene changes rating
      // Defenders stay the same (they're just benchmarks)
      // EXCEPT: if the defender is rank #1, they lose 1 point when defeated
      const isChampionWinner = gauntletChampion && winnerId === gauntletChampion.id;
      const isFallingWinner = gauntletFalling && gauntletFallingItem && winnerId === gauntletFallingItem.id;
      const isChampionLoser = gauntletChampion && loserId === gauntletChampion.id;
      const isFallingLoser = gauntletFalling && gauntletFallingItem && loserId === gauntletFallingItem.id;
      
      const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
      const kFactor = getKFactor(winnerRating, winnerMatchCount, "gauntlet");
      
      // Only the active scene (champion or falling) gets rating changes
      if (isChampionWinner || isFallingWinner) {
        winnerGain = Math.max(0, Math.round(kFactor * (1 - expectedWinner)));
      }
      if (isChampionLoser || isFallingLoser) {
        loserLoss = Math.max(0, Math.round(kFactor * expectedWinner));
      }
      
      // Special case: if defender was rank #1 and lost, drop their rating by 1
      if (loserRank === 1 && !isChampionLoser && !isFallingLoser) {
        loserLoss = 1;
      }
    } else if (currentMode === "champion") {
      // Champion mode: Both performers get rating updates, but at a reduced rate (50% of Swiss mode)
      // This allows rankings to evolve while still maintaining the "winner stays on" feel
      const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
      
      // Use individual K-factors for each performer with champion mode multiplier
      const winnerK = getKFactor(winnerRating, winnerMatchCount, "champion");
      const loserK = getKFactor(loserRating, loserMatchCount, "champion");
      
      // Calculate changes using their respective K-factors (reduced by 50% for champion mode)
      winnerGain = Math.max(0, Math.round(winnerK * (1 - expectedWinner)));
      loserLoss = Math.max(0, Math.round(loserK * expectedWinner));
    } else {
      // Swiss mode: True ELO - both change based on expected outcome
      const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
      
      // Use individual K-factors for each performer for more accurate adjustments
      const winnerK = getKFactor(winnerRating, winnerMatchCount, "swiss");
      const loserK = getKFactor(loserRating, loserMatchCount, "swiss");
      
      // Calculate changes using their respective K-factors
      winnerGain = Math.max(0, Math.round(winnerK * (1 - expectedWinner)));
      loserLoss = Math.max(0, Math.round(loserK * expectedWinner));
    }
    
    const newWinnerRating = Math.min(100, Math.max(1, winnerRating + winnerGain));
    const newLoserRating = Math.min(100, Math.max(1, loserRating - loserLoss));
    
    const winnerChange = newWinnerRating - winnerRating;
    const loserChange = newLoserRating - loserRating;
    
    // Determine which participants should have stats tracked
    const winnerRank = winnerId === currentPair.left?.id ? currentRanks.left : currentRanks.right;
    
    // In champion/gauntlet mode with no champion yet (first match), both participants should get full stats tracked
    const isFirstMatchInGauntletMode = (currentMode === "gauntlet" || currentMode === "champion") && !gauntletChampion;
    const shouldTrackWinner = battleType === "performers" && (isActiveParticipant(winnerId, winnerRank) || isFirstMatchInGauntletMode);
    const shouldTrackLoser = battleType === "performers" && (isActiveParticipant(loserId, loserRank) || isFirstMatchInGauntletMode);
    
    // Update items in Stash
    // Pass win/loss status for stats tracking:
    // - true/false for active participants (track full stats)
    // - null for defenders in gauntlet mode only (track participation only)
    
    // Winner updates
    if (winnerChange !== 0 || (battleType === "performers" && freshWinnerObj && shouldTrackWinner)) {
      // Update rating if changed, or always update stats if active participant
      updateItemRating(winnerId, newWinnerRating, shouldTrackWinner ? freshWinnerObj : null, shouldTrackWinner ? true : null);
    } else if (battleType === "performers" && freshWinnerObj && currentMode === "gauntlet") {
      // Defender in gauntlet mode only - track participation only
      updateItemRating(winnerId, newWinnerRating, freshWinnerObj, null);
    }
    
    // Loser updates
    if (loserChange !== 0 || (battleType === "performers" && freshLoserObj && shouldTrackLoser)) {
      // Update rating if changed, or always update stats if active participant
      updateItemRating(loserId, newLoserRating, shouldTrackLoser ? freshLoserObj : null, shouldTrackLoser ? false : null);
    } else if (battleType === "performers" && freshLoserObj && currentMode === "gauntlet") {
      // Defender in gauntlet mode only - track participation only
      updateItemRating(loserId, newLoserRating, freshLoserObj, null);
    }
    
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
    
    // Always exclude performers without images
    if (performerFilters.excludeWithoutImage) {
      filter.NOT = {
        is_missing: "image"
      };
    }
    
    // Gender filter
    if (performerFilters.gender.enabled && performerFilters.gender.exclude.length > 0) {
      filter.gender = {
        value: performerFilters.gender.exclude,
        modifier: "EXCLUDES"
      };
    }
    
    // Favorites filter
    if (performerFilters.favorites.enabled) {
      filter.filter_favorites = performerFilters.favorites.onlyFavorites;
    }
    
    // Tags filter
    if (performerFilters.tags.enabled && performerFilters.tags.tagIds.length > 0) {
      filter.tags = {
        value: performerFilters.tags.tagIds,
        modifier: performerFilters.tags.mode,
        depth: 0
      };
    }
    
    // Rating filter
    if (performerFilters.rating.enabled) {
      filter.rating100 = {
        value: performerFilters.rating.min,
        value2: performerFilters.rating.max,
        modifier: "BETWEEN"
      };
    }
    
    // Age filter
    if (performerFilters.age.enabled) {
      filter.age = {
        value: performerFilters.age.min,
        value2: performerFilters.age.max,
        modifier: "BETWEEN"
      };
    }
    
    // Ethnicity filter
    if (performerFilters.ethnicity.enabled && performerFilters.ethnicity.value) {
      filter.ethnicity = {
        value: performerFilters.ethnicity.value,
        modifier: performerFilters.ethnicity.modifier
      };
    }
    
    // Country filter
    if (performerFilters.country.enabled && performerFilters.country.value) {
      filter.country = {
        value: performerFilters.country.value,
        modifier: performerFilters.country.modifier
      };
    }
    
    // Height filter
    if (performerFilters.height.enabled) {
      filter.height_cm = {
        value: performerFilters.height.min,
        value2: performerFilters.height.max,
        modifier: "BETWEEN"
      };
    }
    
    // Eye color filter
    if (performerFilters.eyeColor.enabled && performerFilters.eyeColor.value) {
      filter.eye_color = {
        value: performerFilters.eyeColor.value,
        modifier: performerFilters.eyeColor.modifier
      };
    }
    
    // Hair color filter
    if (performerFilters.hairColor.enabled && performerFilters.hairColor.value) {
      filter.hair_color = {
        value: performerFilters.hairColor.value,
        modifier: performerFilters.hairColor.modifier
      };
    }
    
    // Weight filter
    if (performerFilters.weight.enabled) {
      filter.weight = {
        value: performerFilters.weight.min,
        value2: performerFilters.weight.max,
        modifier: "BETWEEN"
      };
    }
    
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

  /**
   * Fetch the latest performer data by ID to get current stats
   * @param {string} performerId - ID of the performer to fetch
   * @returns {Object|null} Performer object with latest data from database, or null if not found
   */
  async function fetchPerformerById(performerId) {
    // Validate performerId is a valid non-empty string
    if (!performerId?.trim?.()) {
      return null;
    }
    
    const performerQuery = `
      query FindPerformer($id: ID!) {
        findPerformer(id: $id) {
          ${PERFORMER_FRAGMENT}
        }
      }
    `;
    
    try {
      const result = await graphqlQuery(performerQuery, { id: performerId });
      return result.findPerformer || null;
    } catch (error) {
      console.error(`[HotOrNot] Error fetching performer ${performerId}:`, error);
      return null;
    }
  }

  /**
   * Calculate a weight for performer selection based on last match time.
   * More recent matches get lower weights (less likely to be selected).
   * Returns a weight between 0.1 (very recent) and 1.0 (not recent or no data).
   * @param {Object} performer - Performer object with custom_fields
   * @returns {number} Weight value between 0.1 and 1.0
   */
  function getRecencyWeight(performer) {
    const stats = parsePerformerEloData(performer);
    
    if (!stats.last_match) {
      // No previous match - full weight
      return 1.0;
    }
    
    try {
      const lastMatchDate = new Date(stats.last_match);
      
      // Check for invalid date
      if (isNaN(lastMatchDate.getTime())) {
        console.warn(`[HotOrNot] Invalid last_match date for performer ${performer.id}`);
        return 1.0;
      }
      
      const lastMatchTime = lastMatchDate.getTime();
      const now = Date.now();
      const hoursSinceMatch = (now - lastMatchTime) / (1000 * 60 * 60);
      
      // Weight calculation:
      // 0-1 hours ago: weight = 0.1 (very unlikely)
      // 1-6 hours ago: weight = 0.3 (less likely)
      // 6-24 hours ago: weight = 0.6 (moderately likely)
      // 24+ hours ago: weight = 1.0 (full probability)
      
      if (hoursSinceMatch < 1) {
        return 0.1;
      } else if (hoursSinceMatch < 6) {
        return 0.3;
      } else if (hoursSinceMatch < 24) {
        return 0.6;
      } else {
        return 1.0;
      }
    } catch (e) {
      // If date parsing fails, give full weight
      console.warn(`[HotOrNot] Failed to parse last_match for performer ${performer.id}:`, e);
      return 1.0;
    }
  }

  /**
   * Select a weighted random item from an array based on weights.
   * @param {Array} items - Array of items to choose from
   * @param {Array} weights - Array of weights (same length as items)
   * @returns {Object|null} Selected item, or null if validation fails
   */
  function weightedRandomSelect(items, weights) {
    // Input validation
    if (!items || !weights || items.length === 0 || weights.length === 0) {
      console.error("[HotOrNot] weightedRandomSelect called with empty arrays");
      return null;
    }
    
    if (items.length !== weights.length) {
      console.error("[HotOrNot] weightedRandomSelect: items and weights arrays have different lengths");
      return null;
    }
    
    // Validate that all weights are numeric
    if (!weights.every(w => typeof w === 'number' && !isNaN(w))) {
      console.error("[HotOrNot] weightedRandomSelect: weights array contains non-numeric values");
      return null;
    }
    
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    // Handle edge case of all zero or negative weights
    if (totalWeight <= 0) {
      console.error("[HotOrNot] Total weight is zero or negative - this indicates a logic error");
      return items[Math.floor(Math.random() * items.length)];
    }
    
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }
    
    // Fallback to last item if rounding errors occur
    return items[items.length - 1];
  }

  // Swiss mode: fetch two performers with similar ratings
  async function fetchSwissPairPerformers() {
    const performerFilter = getPerformerFilter();
    
    // For large performer pools (>1000), use sampling for performance
    // For smaller pools, still get all for accurate ranking
    const totalPerformers = await fetchPerformerCount(performerFilter);
    const useSampling = totalPerformers > 1000;
    const sampleSize = useSampling ? Math.min(500, totalPerformers) : totalPerformers;
    
    const performersQuery = `
      query FindPerformersByRating($performer_filter: PerformerFilterType, $filter: FindFilterType) {
        findPerformers(performer_filter: $performer_filter, filter: $filter) {
          performers {
            ${PERFORMER_FRAGMENT}
          }
        }
      }
    `;

    // Get performers - either all or a random sample
    const result = await graphqlQuery(performersQuery, {
      performer_filter: performerFilter,
      filter: {
        per_page: sampleSize,
        sort: useSampling ? "random" : "rating",
        direction: useSampling ? undefined : "DESC"
      }
    });

    const performers = result.findPerformers.performers || [];
    
    if (performers.length < 2) {
      // Fallback to random if not enough rated performers
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }

    // Calculate weights once and cache them with indices
    const performersWithWeights = performers.map((p, idx) => ({
      performer: p,
      weight: getRecencyWeight(p),
      index: idx
    }));
    
    // Pick a random performer, weighted by recency to avoid repetition
    const weights = performersWithWeights.map(pw => pw.weight);
    const selected1 = weightedRandomSelect(performersWithWeights, weights);
    
    // Fallback to pure random if weighted selection fails
    if (!selected1) {
      console.warn("[HotOrNot] Weighted selection failed, falling back to random");
      return { performers: await fetchRandomPerformers(2), ranks: [null, null] };
    }
    
    const performer1 = selected1.performer;
    const randomIndex = selected1.index;
    const rating1 = performer1.rating100 || 50;

    // Find performers within adaptive rating window (tighter for larger pools)
    const matchWindow = performers.length > 50 ? 10 : performers.length > 20 ? 15 : 25;
    const similarPerformersWithWeights = performersWithWeights.filter(pw => {
      if (pw.performer.id === performer1.id) return false;
      const rating = pw.performer.rating100 || 50;
      return Math.abs(rating - rating1) <= matchWindow;
    });

    let performer2;
    let performer2Index;
    if (similarPerformersWithWeights.length > 0) {
      // Pick from similar-rated performers, using cached weights
      const similarWeights = similarPerformersWithWeights.map(pw => pw.weight);
      const selected2 = weightedRandomSelect(similarPerformersWithWeights, similarWeights);
      
      // Fallback to pure random if weighted selection fails
      if (!selected2) {
        console.warn("[HotOrNot] Weighted selection for performer2 failed, falling back to random");
        const randomSimilar = similarPerformersWithWeights[Math.floor(Math.random() * similarPerformersWithWeights.length)];
        performer2 = randomSimilar.performer;
        performer2Index = randomSimilar.index;
      } else {
        performer2 = selected2.performer;
        performer2Index = selected2.index;
      }
    } else {
      // No similar performers, pick closest with recency weighting
      const otherPerformersWithWeights = performersWithWeights.filter(pw => pw.performer.id !== performer1.id);
      
      // Sort by rating similarity
      otherPerformersWithWeights.sort((a, b) => {
        const diffA = Math.abs((a.performer.rating100 || 50) - rating1);
        const diffB = Math.abs((b.performer.rating100 || 50) - rating1);
        return diffA - diffB;
      });
      
      // Apply weighted selection to the top 3 closest performers (if available)
      const closestCount = Math.min(3, otherPerformersWithWeights.length);
      const closestPerformers = otherPerformersWithWeights.slice(0, closestCount);
      const closestWeights = closestPerformers.map(pw => pw.weight);
      const selected2 = weightedRandomSelect(closestPerformers, closestWeights);
      
      if (selected2) {
        performer2 = selected2.performer;
        performer2Index = selected2.index;
      } else {
        // Ultimate fallback - just pick the closest
        console.warn("[HotOrNot] Weighted selection for closest performer failed, using rating-based fallback");
        performer2 = otherPerformersWithWeights[0].performer;
        performer2Index = otherPerformersWithWeights[0].index;
      }
    }

    return { 
      performers: [performer1, performer2], 
      // When using sampling, ranks are not meaningful (don't represent true position)
      ranks: useSampling ? [null, null] : [randomIndex + 1, performer2Index + 1] 
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
    
    // Pick the next highest-ranked remaining opponent with randomization
    const nextOpponent = selectRandomOpponent(remainingOpponents);
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
    
    // Pick the next highest-ranked remaining opponent with randomization
    const nextOpponent = selectRandomOpponent(remainingOpponents);
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
    // For large image pools (>1000), use sampling for performance
    // For smaller pools, still get all for accurate ranking
    const totalImages = await fetchImageCount();
    const useSampling = totalImages > 1000;
    const sampleSize = useSampling ? Math.min(500, totalImages) : totalImages;
    
    const imagesQuery = `
      query FindImagesByRating($filter: FindFilterType) {
        findImages(filter: $filter) {
          images {
            ${IMAGE_FRAGMENT}
          }
        }
      }
    `;

    // Get images - either all or a random sample
    const result = await graphqlQuery(imagesQuery, {
      filter: {
        per_page: sampleSize,
        sort: useSampling ? "random" : "rating",
        direction: useSampling ? undefined : "DESC"
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

    // Find images within adaptive rating window (tighter for larger pools)
    const matchWindow = images.length > 50 ? 10 : images.length > 20 ? 15 : 25;
    const similarImages = images.filter(s => {
      if (s.id === image1.id) return false;
      const rating = s.rating100 || 50;
      return Math.abs(rating - rating1) <= matchWindow;
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
      // When using sampling, ranks are not meaningful (don't represent true position)
      ranks: useSampling ? [null, null] : [randomIndex + 1, image2Index + 1] 
    };
  }

  // NOTE: Gauntlet and Champion modes for images have been removed.
  // Images now use Swiss mode exclusively for optimal performance.
  // The functions fetchGauntletPairImages() and fetchChampionPairImages() 
  // have been removed as they are no longer needed.

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
      // Images use Swiss mode only - this should never be called
      console.error("[HotOrNot] ERROR: Gauntlet mode called for images (not supported). Using Swiss mode as fallback.");
      return await fetchSwissPairImages();
    } else {
      return await fetchGauntletPairScenes();
    }
  }

  async function fetchChampionPair() {
    if (battleType === "performers") {
      return await fetchChampionPairPerformers();
    } else if (battleType === "images") {
      // Images use Swiss mode only - this should never be called
      console.error("[HotOrNot] ERROR: Champion mode called for images (not supported). Using Swiss mode as fallback.");
      return await fetchSwissPairImages();
    } else {
      return await fetchChampionPairScenes();
    }
  }

  async function updateItemRating(itemId, newRating, itemObj = null, won = null) {
    if (battleType === "performers") {
      return await updatePerformerRating(itemId, newRating, itemObj, won);
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

  // ============================================
  // IMAGE SELECTION (REMOVED)
  // ============================================
  // NOTE: Image selection for gauntlet mode has been removed.
  // Images now use Swiss mode exclusively for optimal performance.
  // Gauntlet and Champion modes are only available for performers.

  // ============================================
  // FILTER FUNCTIONS
  // ============================================

  async function fetchTags(limit = 100) {
    const tagsQuery = `
      query FindTags($filter: FindFilterType) {
        findTags(filter: $filter) {
          tags {
            id
            name
          }
        }
      }
    `;
    
    try {
      const result = await graphqlQuery(tagsQuery, {
        filter: {
          per_page: limit,
          sort: "name",
          direction: "ASC"
        }
      });
      return result.findTags.tags || [];
    } catch (error) {
      console.error("[HotOrNot] Error fetching tags:", error);
      return [];
    }
  }

  function createFilterUI() {
    if (battleType !== "performers") {
      return ''; // Only show filters for performers
    }
    
    return `
      <div class="hon-filters">
        <button class="hon-filter-toggle" id="hon-filter-toggle">
          <span class="hon-filter-icon">🔍</span>
          <span>Filters</span>
          <span class="hon-filter-count" id="hon-filter-count"></span>
        </button>
        
        <div class="hon-filter-panel" id="hon-filter-panel" style="display: none;">
          <div class="hon-filter-header">
            <h3>Filter Performers</h3>
            <button class="hon-filter-reset" id="hon-filter-reset">Reset All</button>
          </div>
          
          <div class="hon-filter-sections">
            <!-- High-Value Filters -->
            <div class="hon-filter-section">
              <h4 class="hon-filter-section-title">General Filters</h4>
              
              <!-- Gender Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-gender-enabled" ${performerFilters.gender.enabled ? 'checked' : ''}>
                  <span>Gender</span>
                </label>
                <div class="hon-filter-options" id="filter-gender-options">
                  <div class="hon-gender-checkboxes">
                    <label><input type="checkbox" value="FEMALE" ${performerFilters.gender.exclude.includes('FEMALE') ? 'checked' : ''}> Exclude Female</label>
                    <label><input type="checkbox" value="MALE" ${performerFilters.gender.exclude.includes('MALE') ? 'checked' : ''}> Exclude Male</label>
                    <label><input type="checkbox" value="TRANSGENDER_MALE" ${performerFilters.gender.exclude.includes('TRANSGENDER_MALE') ? 'checked' : ''}> Exclude Transgender Male</label>
                    <label><input type="checkbox" value="TRANSGENDER_FEMALE" ${performerFilters.gender.exclude.includes('TRANSGENDER_FEMALE') ? 'checked' : ''}> Exclude Transgender Female</label>
                    <label><input type="checkbox" value="INTERSEX" ${performerFilters.gender.exclude.includes('INTERSEX') ? 'checked' : ''}> Exclude Intersex</label>
                    <label><input type="checkbox" value="NON_BINARY" ${performerFilters.gender.exclude.includes('NON_BINARY') ? 'checked' : ''}> Exclude Non-Binary</label>
                  </div>
                </div>
              </div>
              
              <!-- Favorites Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-favorites-enabled" ${performerFilters.favorites.enabled ? 'checked' : ''}>
                  <span>Favorites Only</span>
                </label>
              </div>
              
              <!-- Tags Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-tags-enabled" ${performerFilters.tags.enabled ? 'checked' : ''}>
                  <span>Tags</span>
                </label>
                <div class="hon-filter-options" id="filter-tags-options">
                  <select id="filter-tags-mode" class="hon-filter-select">
                    <option value="INCLUDES" ${performerFilters.tags.mode === 'INCLUDES' ? 'selected' : ''}>Include</option>
                    <option value="EXCLUDES" ${performerFilters.tags.mode === 'EXCLUDES' ? 'selected' : ''}>Exclude</option>
                  </select>
                  <div id="filter-tags-list" class="hon-tags-list">
                    <div class="hon-loading-small">Loading tags...</div>
                  </div>
                </div>
              </div>
              
              <!-- Rating Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-rating-enabled" ${performerFilters.rating.enabled ? 'checked' : ''}>
                  <span>Rating Range</span>
                </label>
                <div class="hon-filter-options" id="filter-rating-options">
                  <div class="hon-range-inputs">
                    <input type="number" id="filter-rating-min" min="1" max="100" value="${performerFilters.rating.min}" placeholder="Min">
                    <span>to</span>
                    <input type="number" id="filter-rating-max" min="1" max="100" value="${performerFilters.rating.max}" placeholder="Max">
                  </div>
                </div>
              </div>
              
              <!-- Age Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-age-enabled" ${performerFilters.age.enabled ? 'checked' : ''}>
                  <span>Age Range</span>
                </label>
                <div class="hon-filter-options" id="filter-age-options">
                  <div class="hon-range-inputs">
                    <input type="number" id="filter-age-min" min="18" max="99" value="${performerFilters.age.min}" placeholder="Min">
                    <span>to</span>
                    <input type="number" id="filter-age-max" min="18" max="99" value="${performerFilters.age.max}" placeholder="Max">
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Physical Attributes -->
            <div class="hon-filter-section">
              <h4 class="hon-filter-section-title">Physical Attributes</h4>
              
              <!-- Ethnicity Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-ethnicity-enabled" ${performerFilters.ethnicity.enabled ? 'checked' : ''}>
                  <span>Ethnicity</span>
                </label>
                <div class="hon-filter-options" id="filter-ethnicity-options">
                  <input type="text" id="filter-ethnicity-value" value="${performerFilters.ethnicity.value}" placeholder="e.g., Asian, Caucasian">
                  <select id="filter-ethnicity-modifier" class="hon-filter-select">
                    <option value="INCLUDES" ${performerFilters.ethnicity.modifier === 'INCLUDES' ? 'selected' : ''}>Includes</option>
                    <option value="EXCLUDES" ${performerFilters.ethnicity.modifier === 'EXCLUDES' ? 'selected' : ''}>Excludes</option>
                  </select>
                </div>
              </div>
              
              <!-- Country Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-country-enabled" ${performerFilters.country.enabled ? 'checked' : ''}>
                  <span>Country</span>
                </label>
                <div class="hon-filter-options" id="filter-country-options">
                  <input type="text" id="filter-country-value" value="${performerFilters.country.value}" placeholder="e.g., USA, Japan">
                  <select id="filter-country-modifier" class="hon-filter-select">
                    <option value="INCLUDES" ${performerFilters.country.modifier === 'INCLUDES' ? 'selected' : ''}>Includes</option>
                    <option value="EXCLUDES" ${performerFilters.country.modifier === 'EXCLUDES' ? 'selected' : ''}>Excludes</option>
                  </select>
                </div>
              </div>
              
              <!-- Height Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-height-enabled" ${performerFilters.height.enabled ? 'checked' : ''}>
                  <span>Height (cm)</span>
                </label>
                <div class="hon-filter-options" id="filter-height-options">
                  <div class="hon-range-inputs">
                    <input type="number" id="filter-height-min" min="100" max="250" value="${performerFilters.height.min}" placeholder="Min">
                    <span>to</span>
                    <input type="number" id="filter-height-max" min="100" max="250" value="${performerFilters.height.max}" placeholder="Max">
                  </div>
                </div>
              </div>
              
              <!-- Eye Color Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-eyecolor-enabled" ${performerFilters.eyeColor.enabled ? 'checked' : ''}>
                  <span>Eye Color</span>
                </label>
                <div class="hon-filter-options" id="filter-eyecolor-options">
                  <input type="text" id="filter-eyecolor-value" value="${performerFilters.eyeColor.value}" placeholder="e.g., Blue, Brown">
                  <select id="filter-eyecolor-modifier" class="hon-filter-select">
                    <option value="INCLUDES" ${performerFilters.eyeColor.modifier === 'INCLUDES' ? 'selected' : ''}>Includes</option>
                    <option value="EXCLUDES" ${performerFilters.eyeColor.modifier === 'EXCLUDES' ? 'selected' : ''}>Excludes</option>
                  </select>
                </div>
              </div>
              
              <!-- Hair Color Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-haircolor-enabled" ${performerFilters.hairColor.enabled ? 'checked' : ''}>
                  <span>Hair Color</span>
                </label>
                <div class="hon-filter-options" id="filter-haircolor-options">
                  <input type="text" id="filter-haircolor-value" value="${performerFilters.hairColor.value}" placeholder="e.g., Blonde, Black">
                  <select id="filter-haircolor-modifier" class="hon-filter-select">
                    <option value="INCLUDES" ${performerFilters.hairColor.modifier === 'INCLUDES' ? 'selected' : ''}>Includes</option>
                    <option value="EXCLUDES" ${performerFilters.hairColor.modifier === 'EXCLUDES' ? 'selected' : ''}>Excludes</option>
                  </select>
                </div>
              </div>
              
              <!-- Weight Filter -->
              <div class="hon-filter-item">
                <label class="hon-filter-label">
                  <input type="checkbox" id="filter-weight-enabled" ${performerFilters.weight.enabled ? 'checked' : ''}>
                  <span>Weight (kg)</span>
                </label>
                <div class="hon-filter-options" id="filter-weight-options">
                  <div class="hon-range-inputs">
                    <input type="number" id="filter-weight-min" min="30" max="200" value="${performerFilters.weight.min}" placeholder="Min">
                    <span>to</span>
                    <input type="number" id="filter-weight-max" min="30" max="200" value="${performerFilters.weight.max}" placeholder="Max">
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="hon-filter-actions">
            <button class="btn btn-primary" id="hon-apply-filters">Apply Filters</button>
          </div>
        </div>
      </div>
    `;
  }

  function updateFilterCount() {
    const countEl = document.getElementById('hon-filter-count');
    if (!countEl) return;
    
    let activeCount = 0;
    if (performerFilters.gender.enabled) activeCount++;
    if (performerFilters.favorites.enabled) activeCount++;
    if (performerFilters.tags.enabled) activeCount++;
    if (performerFilters.rating.enabled) activeCount++;
    if (performerFilters.age.enabled) activeCount++;
    if (performerFilters.ethnicity.enabled) activeCount++;
    if (performerFilters.country.enabled) activeCount++;
    if (performerFilters.height.enabled) activeCount++;
    if (performerFilters.eyeColor.enabled) activeCount++;
    if (performerFilters.hairColor.enabled) activeCount++;
    if (performerFilters.weight.enabled) activeCount++;
    
    if (activeCount > 0) {
      countEl.textContent = `(${activeCount})`;
      countEl.style.display = 'inline';
    } else {
      countEl.style.display = 'none';
    }
  }

  function createMainUI() {
    const itemType = battleType === "performers" ? "performers" : (battleType === "images" ? "images" : "scenes");
    const itemTypeSingular = battleType === "performers" ? "performer" : (battleType === "images" ? "image" : "scene");
    
    // For images, hide mode selection (only use Swiss mode)
    const showModeToggle = battleType !== "images";
    const modeToggleHTML = showModeToggle ? `
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
    ` : '';
    
    return `
      <div id="hotornot-container" class="hon-container">
        <div class="hon-header">
          <h1 class="hon-title">🔥 HotOrNot</h1>
          <p class="hon-subtitle">Compare ${itemType} head-to-head to build your rankings</p>
          ${modeToggleHTML}
          ${createFilterUI()}
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
    // Images don't use gauntlet/champion modes
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
      
      // Images always use Swiss mode
      if (battleType === "images" || currentMode === "swiss") {
        const swissResult = await fetchSwissPair();
        items = swissResult.scenes || swissResult.performers || swissResult.images;
        ranks = swissResult.ranks;
      } else if (currentMode === "gauntlet") {
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
      
      // Update skip button state (only disabled for performers in gauntlet/champion mode)
      const skipBtn = document.querySelector("#hon-skip-btn");
      if (skipBtn) {
        const disableSkip = battleType === "performers" && (currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion;
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

  async function handleChooseItem(event) {
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

    // Images always use Swiss mode logic (no gauntlet/champion)
    if (battleType === "images") {
      const winnerItem = winnerId === currentPair.left.id ? currentPair.left : currentPair.right;
      const loserItem = loserId === currentPair.left.id ? currentPair.left : currentPair.right;
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
      );

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
      return;
    }

    // Handle gauntlet mode (champion tracking) - only for performers
    if (currentMode === "gauntlet") {
      const winnerItem = winnerId === currentPair.left.id ? currentPair.left : currentPair.right;
      const loserItem = loserId === currentPair.left.id ? currentPair.left : currentPair.right;
      
      // Check if we're in falling mode (finding floor after a loss)
      if (gauntletFalling && gauntletFallingItem) {
        if (winnerId === gauntletFallingItem.id) {
          // Falling scene won - found their floor!
          // Set their rating to just above the scene they beat
          const finalRating = Math.min(100, loserRating + 1);
          
          // Fetch latest performer data to get current stats before updating (parallel fetch for performance)
          let freshFallingPerformer = gauntletFallingItem;
          let freshLoserPerformer = loserItem;
          
          if (battleType === "performers") {
            const [fetchedFalling, fetchedLoser] = await Promise.all([
              fetchPerformerById(gauntletFallingItem.id),
              fetchPerformerById(loserId)
            ]);
            freshFallingPerformer = fetchedFalling || gauntletFallingItem;
            freshLoserPerformer = fetchedLoser || loserItem;
          }
          
          // Track this as a win for the falling performer
          updateItemRating(gauntletFallingItem.id, finalRating, freshFallingPerformer, true);
          
          // Track participation for the loser (defender)
          updateItemRating(loserId, loserRating, freshLoserPerformer, null);
          
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
          
          // Fetch latest performer data to get current stats before updating (parallel fetch for performance)
          let freshFallingPerformer = gauntletFallingItem;
          let freshWinnerPerformer = winnerItem;
          
          if (battleType === "performers") {
            const [fetchedFalling, fetchedWinner] = await Promise.all([
              fetchPerformerById(gauntletFallingItem.id),
              fetchPerformerById(winnerId)
            ]);
            freshFallingPerformer = fetchedFalling || gauntletFallingItem;
            freshWinnerPerformer = fetchedWinner || winnerItem;
          }
          
          // Track stats for both participants
          // Track loss for the falling performer
          updateItemRating(gauntletFallingItem.id, loserRating, freshFallingPerformer, false);
          
          // Track participation for the winner (defender)
          updateItemRating(winnerId, winnerRating, freshWinnerPerformer, null);
          
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
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, loserRank, winnerItem, loserItem
      );
      
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
      const loserItem = loserId === currentPair.left.id ? currentPair.left : currentPair.right;
      
      // Calculate rating changes (pass loserRank for #1 dethrone)
      const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
        winnerId, loserId, winnerRating, loserRating, loserRank, winnerItem, loserItem
      );
      
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

    // For Swiss mode (performers only, images are handled above): Calculate and show rating changes
    const winnerItem = winnerId === currentPair.left.id ? currentPair.left : currentPair.right;
    const loserItem = loserId === currentPair.left.id ? currentPair.left : currentPair.right;
    const { newWinnerRating, newLoserRating, winnerChange, loserChange } = await handleComparison(
      winnerId, loserId, winnerRating, loserRating, null, winnerItem, loserItem
    );

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

  async function setupFilterHandlers() {
    const filterToggle = document.getElementById('hon-filter-toggle');
    const filterPanel = document.getElementById('hon-filter-panel');
    const filterReset = document.getElementById('hon-filter-reset');
    const applyFiltersBtn = document.getElementById('hon-apply-filters');
    
    // Toggle filter panel
    if (filterToggle && filterPanel) {
      filterToggle.addEventListener('click', () => {
        const isVisible = filterPanel.style.display !== 'none';
        filterPanel.style.display = isVisible ? 'none' : 'block';
      });
    }
    
    // Reset all filters
    if (filterReset) {
      filterReset.addEventListener('click', () => {
        // Reset to defaults
        performerFilters.gender.enabled = true;
        performerFilters.gender.exclude = ["MALE"];
        performerFilters.favorites.enabled = false;
        performerFilters.tags.enabled = false;
        performerFilters.tags.tagIds = [];
        performerFilters.rating.enabled = false;
        performerFilters.age.enabled = false;
        performerFilters.ethnicity.enabled = false;
        performerFilters.ethnicity.value = "";
        performerFilters.country.enabled = false;
        performerFilters.country.value = "";
        performerFilters.height.enabled = false;
        performerFilters.eyeColor.enabled = false;
        performerFilters.eyeColor.value = "";
        performerFilters.hairColor.enabled = false;
        performerFilters.hairColor.value = "";
        performerFilters.weight.enabled = false;
        
        // Re-render the modal to show reset values
        const modal = document.getElementById("hon-modal");
        if (modal) {
          const content = modal.querySelector(".hon-modal-content");
          if (content) {
            // Save the close button
            const closeBtn = content.querySelector(".hon-modal-close");
            content.innerHTML = '';
            if (closeBtn) content.appendChild(closeBtn);
            content.innerHTML += createMainUI();
            setupFilterHandlers();
          }
        }
        
        updateFilterCount();
        
        // Reload with new filters
        loadNewPair();
      });
    }
    
    // Apply filters button
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener('click', () => {
        applyFilterChanges();
        updateFilterCount();
        
        // Close filter panel
        if (filterPanel) {
          filterPanel.style.display = 'none';
        }
        
        // Reset gauntlet state when filters change
        gauntletChampion = null;
        gauntletWins = 0;
        gauntletDefeated = [];
        gauntletFalling = false;
        gauntletFallingItem = null;
        
        // Reload with new filters
        loadNewPair();
      });
    }
    
    // Load tags for tag filter
    const tagsListEl = document.getElementById('filter-tags-list');
    if (tagsListEl) {
      const tags = await fetchTags();
      if (tags.length > 0) {
        tagsListEl.innerHTML = tags.map(tag => `
          <label class="hon-tag-checkbox">
            <input type="checkbox" value="${tag.id}" ${performerFilters.tags.tagIds.includes(tag.id) ? 'checked' : ''}>
            <span>${tag.name}</span>
          </label>
        `).join('');
      } else {
        tagsListEl.innerHTML = '<div class="hon-no-tags">No tags available</div>';
      }
    }
    
    updateFilterCount();
  }
  
  function applyFilterChanges() {
    // Gender filter
    const genderEnabled = document.getElementById('filter-gender-enabled');
    if (genderEnabled) {
      performerFilters.gender.enabled = genderEnabled.checked;
      const genderCheckboxes = document.querySelectorAll('#filter-gender-options input[type="checkbox"]');
      performerFilters.gender.exclude = Array.from(genderCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
    }
    
    // Favorites filter
    const favoritesEnabled = document.getElementById('filter-favorites-enabled');
    if (favoritesEnabled) {
      performerFilters.favorites.enabled = favoritesEnabled.checked;
    }
    
    // Tags filter
    const tagsEnabled = document.getElementById('filter-tags-enabled');
    const tagsMode = document.getElementById('filter-tags-mode');
    if (tagsEnabled) {
      performerFilters.tags.enabled = tagsEnabled.checked;
      if (tagsMode) performerFilters.tags.mode = tagsMode.value;
      const tagCheckboxes = document.querySelectorAll('#filter-tags-list input[type="checkbox"]');
      performerFilters.tags.tagIds = Array.from(tagCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
    }
    
    // Rating filter
    const ratingEnabled = document.getElementById('filter-rating-enabled');
    const ratingMin = document.getElementById('filter-rating-min');
    const ratingMax = document.getElementById('filter-rating-max');
    if (ratingEnabled) {
      performerFilters.rating.enabled = ratingEnabled.checked;
      if (ratingMin) performerFilters.rating.min = parseInt(ratingMin.value) || 1;
      if (ratingMax) performerFilters.rating.max = parseInt(ratingMax.value) || 100;
    }
    
    // Age filter
    const ageEnabled = document.getElementById('filter-age-enabled');
    const ageMin = document.getElementById('filter-age-min');
    const ageMax = document.getElementById('filter-age-max');
    if (ageEnabled) {
      performerFilters.age.enabled = ageEnabled.checked;
      if (ageMin) performerFilters.age.min = parseInt(ageMin.value) || 18;
      if (ageMax) performerFilters.age.max = parseInt(ageMax.value) || 99;
    }
    
    // Ethnicity filter
    const ethnicityEnabled = document.getElementById('filter-ethnicity-enabled');
    const ethnicityValue = document.getElementById('filter-ethnicity-value');
    const ethnicityModifier = document.getElementById('filter-ethnicity-modifier');
    if (ethnicityEnabled) {
      performerFilters.ethnicity.enabled = ethnicityEnabled.checked;
      if (ethnicityValue) performerFilters.ethnicity.value = ethnicityValue.value.trim();
      if (ethnicityModifier) performerFilters.ethnicity.modifier = ethnicityModifier.value;
    }
    
    // Country filter
    const countryEnabled = document.getElementById('filter-country-enabled');
    const countryValue = document.getElementById('filter-country-value');
    const countryModifier = document.getElementById('filter-country-modifier');
    if (countryEnabled) {
      performerFilters.country.enabled = countryEnabled.checked;
      if (countryValue) performerFilters.country.value = countryValue.value.trim();
      if (countryModifier) performerFilters.country.modifier = countryModifier.value;
    }
    
    // Height filter
    const heightEnabled = document.getElementById('filter-height-enabled');
    const heightMin = document.getElementById('filter-height-min');
    const heightMax = document.getElementById('filter-height-max');
    if (heightEnabled) {
      performerFilters.height.enabled = heightEnabled.checked;
      if (heightMin) performerFilters.height.min = parseInt(heightMin.value) || 140;
      if (heightMax) performerFilters.height.max = parseInt(heightMax.value) || 200;
    }
    
    // Eye color filter
    const eyeColorEnabled = document.getElementById('filter-eyecolor-enabled');
    const eyeColorValue = document.getElementById('filter-eyecolor-value');
    const eyeColorModifier = document.getElementById('filter-eyecolor-modifier');
    if (eyeColorEnabled) {
      performerFilters.eyeColor.enabled = eyeColorEnabled.checked;
      if (eyeColorValue) performerFilters.eyeColor.value = eyeColorValue.value.trim();
      if (eyeColorModifier) performerFilters.eyeColor.modifier = eyeColorModifier.value;
    }
    
    // Hair color filter
    const hairColorEnabled = document.getElementById('filter-haircolor-enabled');
    const hairColorValue = document.getElementById('filter-haircolor-value');
    const hairColorModifier = document.getElementById('filter-haircolor-modifier');
    if (hairColorEnabled) {
      performerFilters.hairColor.enabled = hairColorEnabled.checked;
      if (hairColorValue) performerFilters.hairColor.value = hairColorValue.value.trim();
      if (hairColorModifier) performerFilters.hairColor.modifier = hairColorModifier.value;
    }
    
    // Weight filter
    const weightEnabled = document.getElementById('filter-weight-enabled');
    const weightMin = document.getElementById('filter-weight-min');
    const weightMax = document.getElementById('filter-weight-max');
    if (weightEnabled) {
      performerFilters.weight.enabled = weightEnabled.checked;
      if (weightMin) performerFilters.weight.min = parseInt(weightMin.value) || 40;
      if (weightMax) performerFilters.weight.max = parseInt(weightMax.value) || 150;
    }
  }

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
      // For images, always use Swiss mode
      currentMode = "swiss";
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

    // Mode toggle buttons (only shown for performers)
    modal.querySelectorAll(".hon-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Images always stay in Swiss mode
        if (battleType === "images") return;
        
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
          
          // Hide performer/image selection if not in gauntlet mode
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
        // In gauntlet/champion mode with active run (performers only), skip is disabled
        if (battleType === "performers" && (currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion) {
          return;
        }
        if(disableChoice) return
        disableChoice = true;
        // Reset state on skip (only for performers)
        if (battleType === "performers" && (currentMode === "gauntlet" || currentMode === "champion")) {
          gauntletChampion = null;
          gauntletWins = 0;
          gauntletDefeated = [];
          gauntletFalling = false;
          gauntletFallingItem = null;
        }
        loadNewPair();
      });
    }

    // Filter UI event handlers (only for performers)
    if (battleType === "performers") {
      setupFilterHandlers();
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
          // Don't skip during active gauntlet/champion run (performers only)
          if (battleType === "performers" && (currentMode === "gauntlet" || currentMode === "champion") && gauntletChampion) {
            return;
          }
          // TODO: Put these skip functionalities into ONE function
          if(disableChoice) return;
          disableChoice = true;
          if (battleType === "performers" && (currentMode === "gauntlet" || currentMode === "champion")) {
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