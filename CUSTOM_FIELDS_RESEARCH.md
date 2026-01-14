# Custom Fields Research for ELO Match Tracking

## Overview

This document explores how Stash's custom fields functionality can be used to enhance the HotOrNot ELO ranking system by tracking match history, statistics, and other metadata for performers.

## Current Implementation

### What's Currently Stored

The HotOrNot plugin currently stores **only** the ELO rating in Stash's built-in `rating100` field:

```javascript
// Current PERFORMER_FRAGMENT (lines 62-71)
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
```

### What's NOT Stored

The following data exists only in the browser's memory during a comparison session and is lost when the session ends:

- **Match History**: Which performers faced each other
- **Win/Loss Records**: Individual match outcomes
- **Comparison Count**: How many comparisons a performer has participated in
- **Win Streaks**: Current or historical winning/losing streaks
- **Head-to-Head Records**: Performance against specific opponents
- **Timestamp Data**: When comparisons occurred
- **Mode-Specific Stats**: Performance in Swiss vs Gauntlet vs Champion modes

## Stash Custom Fields Capability

### How Custom Fields Work in Stash

Based on research, Stash supports custom fields through the **`details`** field on performers:

1. **Storage Format**: JSON object stored in the `details` field
2. **Structure**: 
   ```json
   {
     "custom": {
       "field1": "value1",
       "field2": "value2"
     },
     "details": "Original bio/notes text"
   }
   ```
3. **Access Method**: Via GraphQL query/mutation on the `details` field
4. **Limitations**: 
   - Cannot filter/search by custom field values in GraphQL queries
   - Must fetch all performers and filter client-side
   - Manual JSON parsing required

### GraphQL API Access

**Query Example:**
```graphql
query {
  findPerformer(id: "PERFORMER_ID") {
    id
    name
    details
    rating100
  }
}
```

**Mutation Example:**
```graphql
mutation PerformerUpdate($input: PerformerUpdateInput!) {
  performerUpdate(input: $input) {
    id
    details
    rating100
  }
}
```

**Variables:**
```json
{
  "input": {
    "id": "PERFORMER_ID",
    "details": "{\"custom\": {\"hotornot_stats\": {...}}, \"details\": \"Bio text\"}"
  }
}
```

## Potential Use Cases for Match Tracking

### 1. Match Count Tracking

**Purpose**: Know how many comparisons each performer has participated in

**Benefits**:
- Implement dynamic K-factor based on experience (not just rating distance)
- Display "confidence level" for ratings (more matches = higher confidence)
- Identify performers that need more comparisons
- Show "New" badge for performers with <10 matches

**Data Structure**:
```json
{
  "custom": {
    "elo_matches": {
      "total": 42,
      "wins": 28,
      "losses": 14,
      "last_match": "2026-01-14T18:00:00Z"
    }
  }
}
```

### 2. Mode-Specific Statistics

**Purpose**: Track performance across different comparison modes

**Benefits**:
- Identify performers who excel in certain modes
- Separate rankings for Swiss vs Gauntlet vs Champion
- More nuanced performance analysis

**Data Structure**:
```json
{
  "custom": {
    "hotornot_stats": {
      "swiss": {
        "matches": 20,
        "wins": 12,
        "losses": 8
      },
      "gauntlet": {
        "matches": 15,
        "wins": 10,
        "losses": 5,
        "highest_climb": 25
      },
      "champion": {
        "matches": 7,
        "wins": 4,
        "losses": 3,
        "longest_streak": 5
      }
    }
  }
}
```

### 3. Head-to-Head History

**Purpose**: Track matchups between specific performers

**Benefits**:
- Avoid repeat matchups in short sessions
- Display rivalry statistics
- Prevent boring rematches
- Create "nemesis" or "favorite victim" insights

**Data Structure**:
```json
{
  "custom": {
    "elo_matchups": {
      "performer_123": {
        "wins": 3,
        "losses": 1,
        "last_match": "2026-01-14T17:30:00Z"
      },
      "performer_456": {
        "wins": 0,
        "losses": 2,
        "last_match": "2026-01-14T16:00:00Z"
      }
    }
  }
}
```

**Alternative (More Compact)**:
```json
{
  "custom": {
    "elo_recent_opponents": [
      "performer_123",
      "performer_456",
      "performer_789"
    ]
  }
}
```

### 4. Rating History

**Purpose**: Track rating changes over time

**Benefits**:
- Display rating trend graphs
- Identify rating volatility
- Detect sandbagging or artificial inflation
- Show "rising star" or "falling star" performers

**Data Structure**:
```json
{
  "custom": {
    "elo_history": [
      {"date": "2026-01-10", "rating": 50},
      {"date": "2026-01-12", "rating": 62},
      {"date": "2026-01-14", "rating": 68}
    ]
  }
}
```

**Alternative (Last N ratings only)**:
```json
{
  "custom": {
    "elo_last_10_ratings": [50, 52, 55, 58, 62, 64, 66, 68, 67, 68]
  }
}
```

### 5. Enhanced K-Factor Algorithm

**Purpose**: Use match count for more sophisticated K-factor calculation

**Current Implementation** (lines 580-591):
```javascript
function getKFactor(currentRating) {
  const distanceFromDefault = Math.abs(currentRating - 50);
  if (distanceFromDefault < 10) return 12;
  else if (distanceFromDefault < 25) return 10;
  else return 8;
}
```

**Enhanced Implementation with Custom Fields**:
```javascript
function getKFactor(currentRating, matchCount) {
  // New performers: High K-factor for fast convergence
  if (matchCount < 10) return 16;
  
  // Moderately established: Medium K-factor
  if (matchCount < 30) return 12;
  
  // Well-established: Low K-factor for stability
  if (matchCount >= 50) return 8;
  
  // Transition zone: 30-50 matches
  return 10;
}
```

**Benefits**:
- True measure of establishment (not proxy via rating distance)
- New performers stabilize faster
- Established ratings protected from volatility
- More accurate than rating-based heuristic

## Implementation Approaches

### Approach 1: Minimal - Match Count Only

**What to Track**: Just the total number of comparisons

**Complexity**: Low

**Code Changes**:
1. Add `details` to `PERFORMER_FRAGMENT`
2. Parse `details` JSON to extract match count
3. Increment count after each comparison
4. Update `details` field via mutation
5. Use match count in K-factor calculation

**Storage Example**:
```json
{
  "custom": {
    "elo_matches": 42
  }
}
```

**Pros**:
- Simple implementation
- Minimal data storage
- Enables better K-factor algorithm
- Low performance impact

**Cons**:
- Limited insights
- No win/loss tracking
- Can't avoid repeat matchups

### Approach 2: Moderate - Stats Tracking

**What to Track**: Match count, wins, losses, last match date

**Complexity**: Medium

**Code Changes**:
1. Add `details` to `PERFORMER_FRAGMENT`
2. Parse and update stats after each comparison
3. Update both `rating100` and `details` in mutations
4. Display stats in UI (optional)

**Storage Example**:
```json
{
  "custom": {
    "hotornot_stats": {
      "total_matches": 42,
      "wins": 28,
      "losses": 14,
      "last_match": "2026-01-14T18:00:00Z",
      "current_streak": 5,
      "best_streak": 8
    }
  }
}
```

**Pros**:
- Rich statistics
- Better K-factor algorithm
- User engagement (show stats)
- Streak tracking

**Cons**:
- More complex code
- Larger data storage
- More mutation overhead

### Approach 3: Comprehensive - Full History

**What to Track**: Everything including recent opponents and mode-specific stats

**Complexity**: High

**Code Changes**:
1. Add `details` to `PERFORMER_FRAGMENT`
2. Track mode-specific statistics
3. Maintain recent opponent list
4. Update complex JSON structure
5. Create UI for displaying detailed stats

**Storage Example**:
```json
{
  "custom": {
    "elo_data": {
      "total_matches": 42,
      "overall": {"wins": 28, "losses": 14},
      "swiss": {"matches": 20, "wins": 12, "losses": 8},
      "gauntlet": {"matches": 15, "wins": 10, "losses": 5},
      "champion": {"matches": 7, "wins": 6, "losses": 1},
      "recent_opponents": ["id1", "id2", "id3", "id4", "id5"],
      "last_match": "2026-01-14T18:00:00Z"
    }
  }
}
```

**Pros**:
- Complete match tracking
- Avoid repeat matchups
- Mode-specific analysis
- Rich user insights
- Future-proof for analytics

**Cons**:
- Complex implementation
- Potential performance issues
- Larger storage footprint
- More prone to bugs

## Implementation Example: Approach 1 (Minimal)

### Step 1: Update PERFORMER_FRAGMENT

```javascript
const PERFORMER_FRAGMENT = `
  id
  name
  image_path
  rating100
  details
  birthdate
  ethnicity
  country
  gender
`;
```

### Step 2: Helper Functions

```javascript
// Parse custom fields from details JSON
function parsePerformerEloData(performer) {
  if (!performer.details) {
    return { matches: 0 };
  }
  
  try {
    const detailsObj = JSON.parse(performer.details);
    return {
      matches: detailsObj?.custom?.elo_matches || 0,
      detailsText: detailsObj?.details || ""
    };
  } catch (e) {
    console.warn(`[HotOrNot] Failed to parse details for performer ${performer.id}:`, e);
    return { matches: 0, detailsText: performer.details };
  }
}

// Create updated details JSON with incremented match count
function updatePerformerEloData(performer, increment = 1) {
  const current = parsePerformerEloData(performer);
  
  return JSON.stringify({
    custom: {
      elo_matches: current.matches + increment
    },
    details: current.detailsText
  });
}

// Enhanced K-factor using match count
function getKFactor(currentRating, matchCount) {
  // New performers: High K-factor for fast convergence
  if (matchCount < 10) return 16;
  
  // Moderately established: Medium K-factor
  if (matchCount < 30) return 12;
  
  // Well-established: Low K-factor for stability
  return 8;
}
```

### Step 3: Update performerUpdate Mutation

```javascript
async function updatePerformerRating(performerId, newRating, performer = null) {
  const mutation = `
    mutation PerformerUpdate($input: PerformerUpdateInput!) {
      performerUpdate(input: $input) {
        id
        rating100
        details
      }
    }
  `;
  
  const input = {
    id: performerId,
    rating100: Math.round(newRating)
  };
  
  // If performer object provided, update match count
  if (performer) {
    input.details = updatePerformerEloData(performer, 1);
  }
  
  return await graphqlQuery(mutation, { input });
}
```

### Step 4: Update Comparison Handler

```javascript
async function handleComparison(winnerId, loserId, winnerObj, loserObj) {
  // ... existing ELO calculation code ...
  
  // Parse match counts for K-factor
  const winnerData = parsePerformerEloData(winnerObj);
  const loserData = parsePerformerEloData(loserObj);
  
  // Use enhanced K-factor with match count
  const winnerK = getKFactor(winnerRating, winnerData.matches);
  const loserK = getKFactor(loserRating, loserData.matches);
  
  // Calculate rating changes
  const ratingDiff = loserRating - winnerRating;
  const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
  
  const winnerGain = Math.max(0, Math.round(winnerK * (1 - expectedWinner)));
  const loserLoss = Math.max(0, Math.round(loserK * expectedWinner));
  
  // Update ratings and match counts
  await updatePerformerRating(winnerId, newWinnerRating, winnerObj);
  await updatePerformerRating(loserId, newLoserRating, loserObj);
}
```

## Performance Considerations

### Read Performance

**Current**: 
- Query fetches: `id`, `name`, `image_path`, `rating100`, `birthdate`, `ethnicity`, `country`, `gender`
- ~100-200 bytes per performer

**With Custom Fields**:
- Additional field: `details` (JSON string)
- Estimated size: +50-200 bytes per performer (depending on approach)
- Impact: Minimal for small/medium libraries (<1000 performers)

### Write Performance

**Current**: 
- 1-2 mutations per comparison (Swiss mode updates both)
- Only `rating100` field updated

**With Custom Fields**:
- Same number of mutations
- Additional JSON serialization/deserialization
- Slightly larger payload size
- Impact: Negligible for typical usage

### Storage Impact

**Approach 1 (Minimal)**:
- Per performer: ~50 bytes
- 100 performers: ~5 KB
- 1000 performers: ~50 KB

**Approach 2 (Moderate)**:
- Per performer: ~150 bytes
- 100 performers: ~15 KB
- 1000 performers: ~150 KB

**Approach 3 (Comprehensive)**:
- Per performer: ~300-500 bytes
- 100 performers: ~40 KB
- 1000 performers: ~400 KB

**Conclusion**: Storage impact is minimal even for large libraries

## Recommendations

### For Immediate Implementation

**Recommended: Approach 1 (Minimal - Match Count Only)**

**Rationale**:
1. ✅ Solves the main ELO algorithm weakness (K-factor calculation)
2. ✅ Simple to implement and test
3. ✅ Minimal performance impact
4. ✅ Backward compatible (works with existing ratings)
5. ✅ Foundation for future enhancements

**Implementation Steps**:
1. Add `details` to `PERFORMER_FRAGMENT`
2. Create helper functions for parsing/updating
3. Modify `updatePerformerRating()` to accept performer object
4. Update K-factor calculation to use match count
5. Test with small performer set
6. Document the change

### For Future Enhancement

**Consider: Approach 2 (Moderate - Stats Tracking)**

**When to Implement**:
- After Approach 1 is stable and tested
- User requests for statistics/insights
- Want to display match history in UI

**Additional Features**:
- Win/loss records
- Win streaks
- Last match timestamp
- Performance trends

### Not Recommended (Yet)

**Skip: Approach 3 (Comprehensive)**

**Rationale**:
- Adds significant complexity
- Most features not immediately useful
- Can be added incrementally later
- Risk of bugs outweighs benefits

**When to Reconsider**:
- Users specifically request opponent history
- Want to build analytics dashboard
- Have established test coverage
- Approach 2 proves stable

## Migration Strategy

### Handling Existing Performers

**Challenge**: Existing performers have no `details` field or have plain text details

**Solution**: Graceful degradation

```javascript
function parsePerformerEloData(performer) {
  // No details field = new performer with 0 matches
  if (!performer.details) {
    return { matches: 0, detailsText: "" };
  }
  
  try {
    // Try to parse as JSON
    const detailsObj = JSON.parse(performer.details);
    return {
      matches: detailsObj?.custom?.elo_matches || 0,
      detailsText: detailsObj?.details || ""
    };
  } catch (e) {
    // Not JSON = legacy text details
    // Preserve existing text, start match count at 0
    return { 
      matches: 0, 
      detailsText: performer.details 
    };
  }
}
```

**Migration is automatic**: First comparison will convert text to JSON

### Estimating Initial Match Counts

**Option 1**: Start everyone at 0 (simplest)
- Pro: Simple, honest
- Con: Established ratings treated as new

**Option 2**: Estimate based on rating distance from 50
- Pro: Better reflects establishment
- Con: Heuristic, not accurate

**Option 3**: Keep current K-factor algorithm, add match tracking
- Pro: No disruption to existing system
- Con: Doesn't immediately improve K-factor

**Recommended: Option 1** - Start fresh, builds accurate data going forward

## Testing Strategy

### Unit Tests

```javascript
// Test parsing empty details
assert(parsePerformerEloData({details: ""}).matches === 0);

// Test parsing JSON details
assert(parsePerformerEloData({
  details: '{"custom": {"elo_matches": 15}}'
}).matches === 15);

// Test parsing legacy text details
assert(parsePerformerEloData({
  details: "This is a bio"
}).matches === 0);

// Test K-factor calculation
assert(getKFactor(50, 5) === 16);   // New
assert(getKFactor(50, 20) === 12);  // Moderate
assert(getKFactor(50, 100) === 8);  // Established
```

### Integration Tests

1. Create test performer with no details
2. Run comparison
3. Verify `details` field updated
4. Verify `elo_matches` incremented
5. Run another comparison
6. Verify count increments again

### Manual Testing

1. Backup database
2. Install modified plugin
3. Run several comparisons
4. Check performer details in Stash UI
5. Verify JSON structure correct
6. Verify ratings still update properly
7. Test with performers with existing text details
8. Verify text preserved in migration

## Code Example: Complete Minimal Implementation

### Modified PERFORMER_FRAGMENT

```javascript
const PERFORMER_FRAGMENT = `
  id
  name
  image_path
  rating100
  details
  birthdate
  ethnicity
  country
  gender
`;
```

### Helper Functions

```javascript
/**
 * Parse ELO match data from performer details JSON
 * @param {Object} performer - Performer object from GraphQL
 * @returns {Object} { matches: number, detailsText: string }
 */
function parsePerformerEloData(performer) {
  if (!performer.details) {
    return { matches: 0, detailsText: "" };
  }
  
  try {
    const detailsObj = JSON.parse(performer.details);
    return {
      matches: detailsObj?.custom?.elo_matches || 0,
      detailsText: detailsObj?.details || ""
    };
  } catch (e) {
    // Legacy text details - preserve as-is
    return { 
      matches: 0, 
      detailsText: performer.details 
    };
  }
}

/**
 * Create updated details JSON with incremented match count
 * @param {Object} performer - Performer object
 * @param {number} increment - Amount to increment (default 1)
 * @returns {string} JSON string for details field
 */
function updatePerformerEloData(performer, increment = 1) {
  const current = parsePerformerEloData(performer);
  
  return JSON.stringify({
    custom: {
      elo_matches: current.matches + increment
    },
    details: current.detailsText
  });
}

/**
 * Calculate K-factor based on match count (experience)
 * @param {number} currentRating - Current ELO rating
 * @param {number} matchCount - Number of matches played
 * @returns {number} K-factor value
 */
function getKFactor(currentRating, matchCount) {
  // New performers: High K-factor for fast convergence
  if (matchCount < 10) {
    return 16;
  }
  
  // Moderately established: Medium K-factor
  if (matchCount < 30) {
    return 12;
  }
  
  // Well-established: Low K-factor for stability
  return 8;
}
```

### Updated Rating Function

```javascript
/**
 * Update performer rating and match count in Stash
 * @param {string} performerId - Performer ID
 * @param {number} newRating - New ELO rating
 * @param {Object} performerObj - Full performer object (optional, for match tracking)
 */
async function updatePerformerRating(performerId, newRating, performerObj = null) {
  const mutation = `
    mutation PerformerUpdate($input: PerformerUpdateInput!) {
      performerUpdate(input: $input) {
        id
        rating100
        details
      }
    }
  `;
  
  const input = {
    id: performerId,
    rating100: Math.round(newRating)
  };
  
  // Update match count if performer object provided
  if (performerObj) {
    input.details = updatePerformerEloData(performerObj, 1);
  }
  
  return await graphqlQuery(mutation, { input });
}
```

### Modified Comparison Logic (Example Section)

```javascript
// In handleComparison function, around line 600:

async function handleComparison(winnerId, loserId, winnerObj, loserObj) {
  const winnerRating = winnerObj.rating100 || 50;
  const loserRating = loserObj.rating100 || 50;
  
  // Parse match counts from custom fields
  const winnerData = parsePerformerEloData(winnerObj);
  const loserData = parsePerformerEloData(loserObj);
  
  // Calculate K-factors based on match experience
  const winnerK = getKFactor(winnerRating, winnerData.matches);
  const loserK = getKFactor(loserRating, loserData.matches);
  
  // Calculate expected score
  const ratingDiff = loserRating - winnerRating;
  const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
  
  // Calculate rating changes (using winner's K-factor for both in Swiss mode)
  const kFactor = winnerK; // Or loserK, or average, depending on design choice
  const winnerGain = Math.max(0, Math.round(kFactor * (1 - expectedWinner)));
  const loserLoss = Math.max(0, Math.round(kFactor * expectedWinner));
  
  const newWinnerRating = Math.min(100, Math.max(1, winnerRating + winnerGain));
  const newLoserRating = Math.min(100, Math.max(1, loserRating - loserLoss));
  
  // Update both rating and match count
  if (winnerGain !== 0) {
    await updatePerformerRating(winnerId, newWinnerRating, winnerObj);
  }
  if (loserLoss !== 0) {
    await updatePerformerRating(loserId, newLoserRating, loserObj);
  }
  
  // Log for debugging
  console.log(`[HotOrNot] Match: Winner (${winnerData.matches} matches, K=${winnerK}) ` +
              `vs Loser (${loserData.matches} matches, K=${loserK})`);
}
```

## Summary

### Key Findings

1. ✅ **Stash supports custom fields** via the `details` field (JSON storage)
2. ✅ **GraphQL access** available for reading and writing
3. ⚠️ **No query filtering** - must fetch and filter client-side
4. ✅ **Backward compatible** - can preserve existing text details
5. ✅ **Minimal performance impact** for reasonable data sizes

### Implementation Status

1. **✅ IMPLEMENTED - Phase 1**: Match count tracking (Approach 1)
   - Enables improved K-factor algorithm
   - Simple, low-risk implementation
   - Immediate ELO algorithm improvement
   - See: `MATCH_COUNT_IMPLEMENTATION.md`

2. **✅ IMPLEMENTED - Phase 2**: Stats tracking (Approach 2)
   - Win/loss records
   - Streaks and trends
   - Last match timestamps
   - User-facing statistics ready for UI display
   - See: `APPROACH2_IMPLEMENTATION.md`

3. **Phase 3** (Optional - Future): Comprehensive tracking (Approach 3)
   - Recent opponent history
   - Mode-specific stats
   - Analytics dashboard
   - Advanced insights

### Recommended Next Steps

1. ~~Review and discuss this research~~ ✅ Complete
2. ~~Decide on implementation approach~~ ✅ Approach 1 & 2 chosen
3. ~~Create implementation plan~~ ✅ Complete
4. ~~Write tests~~ ✅ Complete
5. ~~Implement changes~~ ✅ Approach 1 & 2 implemented
6. ~~Test thoroughly~~ ✅ Complete
7. **NEW**: Add UI display of statistics (wins, losses, streaks)
8. **NEW**: Consider implementing Approach 3 features if needed

## References

- [Stash API Documentation](https://docs.stashapp.cc/api/)
- [Stash Performer Custom Fields Plugin](https://github.com/7dJx1qP/stash-plugins/blob/main/plugins/stashPerformerCustomFields/README.md)
- [Current ELO Analysis Document](./ELO_ANALYSIS.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
