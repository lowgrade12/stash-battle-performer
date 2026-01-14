# Approach 2 Implementation - Stats Tracking

## Overview

This document describes the implementation of **Approach 2: Moderate - Stats Tracking** from the CUSTOM_FIELDS_RESEARCH.md document. This extends the basic match count tracking (Approach 1) with comprehensive statistics including wins, losses, streaks, and timestamps.

## What Changed from Approach 1

### Before (Approach 1 - Match Count Only)
```javascript
{
  custom_fields: {
    elo_matches: "42"
  }
}
```

### After (Approach 2 - Stats Tracking)
```javascript
{
  custom_fields: {
    elo_stats: JSON.stringify({
      total_matches: 42,
      wins: 28,
      losses: 14,
      current_streak: 5,
      best_streak: 8,
      worst_streak: -3,
      last_match: "2026-01-14T18:00:00Z"
    })
  }
}
```

## Features

### Statistics Tracked

1. **total_matches**: Total number of comparisons participated in
2. **wins**: Number of wins
3. **losses**: Number of losses  
4. **current_streak**: Current win/loss streak
   - Positive numbers = win streak (e.g., 5 = 5 wins in a row)
   - Negative numbers = loss streak (e.g., -3 = 3 losses in a row)
5. **best_streak**: Best (longest) win streak achieved
6. **worst_streak**: Worst (longest) loss streak (stored as negative number)
7. **last_match**: ISO 8601 timestamp of most recent match

### Streak Calculation Logic

- **Win after win**: Increment positive streak (0→1, 1→2, 2→3, etc.)
- **Loss after loss**: Decrement negative streak (0→-1, -1→-2, -2→-3, etc.)
- **Win after loss**: Reset to +1 win streak
- **Loss after win**: Reset to -1 loss streak
- **Best streak**: Maximum positive streak ever achieved
- **Worst streak**: Minimum (most negative) streak ever achieved

## Implementation Details

### Helper Functions

#### parsePerformerEloData(performer)

Parses stats from custom_fields with backward compatibility:

1. **First** tries to parse `elo_stats` (Approach 2)
2. **Falls back** to `elo_matches` (Approach 1) 
3. **Defaults** to empty stats if nothing found

Returns object:
```javascript
{
  total_matches: number,
  wins: number,
  losses: number,
  current_streak: number,
  best_streak: number,
  worst_streak: number,
  last_match: string | null
}
```

#### updatePerformerStats(currentStats, won)

Updates stats after a match:

- Increments `total_matches`
- Increments `wins` or `losses` based on outcome
- Calculates new streak values
- Updates `best_streak` and `worst_streak` if new records
- Sets `last_match` to current timestamp

Returns updated stats object.

### Modified Functions

#### updatePerformerRating(performerId, newRating, performerObj)

- Now saves complete stats as JSON in `elo_stats` custom field
- Uses `performerObj._tempWon` flag to determine win/loss
- Maintains backward compatibility

#### handleComparison(winnerId, loserId, ..., winnerObj, loserObj)

- Sets `_tempWon` flag on winner (true) and loser (false)
- **Swiss mode**: Tracks stats for both participants
- **Gauntlet/Champion mode**: Only tracks stats for active champion/falling performer
- Special case: Rank #1 defender who loses also gets stats tracked

## Mode-Specific Behavior

### Swiss Mode
- **Both performers** get stats tracked
- Winner gets `_tempWon = true`
- Loser gets `_tempWon = false`
- Both have match counts incremented

### Gauntlet Mode
- **Only champion/falling performer** gets stats tracked
- Defenders are benchmarks - no stats updates
- **Exception**: Rank #1 defender who loses gets their loss recorded

### Champion Mode
- Same as Gauntlet mode
- Only active champion gets stats tracked
- Defenders don't get updates

## Backward Compatibility

### Upgrading from Approach 1

Performers with only `elo_matches` field:
- Stats are parsed with `total_matches = elo_matches`
- Wins, losses, streaks all start at 0
- First new match migrates to Approach 2 format
- Old `elo_matches` field can remain (won't be updated)

### Fresh Installations

- Performers without any custom fields start with empty stats
- First comparison creates `elo_stats` field automatically

### Data Coexistence

Both formats can coexist safely:
```javascript
{
  custom_fields: {
    elo_matches: "15",      // Approach 1 (ignored if elo_stats exists)
    elo_stats: "{...}"      // Approach 2 (takes precedence)
  }
}
```

## Testing

### Unit Tests

Run: `node /tmp/test_approach2_stats.js`

Tests verify:
- ✅ Empty performer parsing
- ✅ Backward compatibility with Approach 1
- ✅ Approach 2 stats parsing
- ✅ First win from empty stats
- ✅ Win streak continuation
- ✅ Loss breaks win streak
- ✅ Loss streak
- ✅ Win breaks loss streak

All tests passed ✅

### Manual Testing Checklist

1. **Fresh performer**
   - [ ] Start with no custom fields
   - [ ] Win first match
   - [ ] Verify stats: `{total_matches: 1, wins: 1, losses: 0, current_streak: 1, ...}`

2. **Win streak**
   - [ ] Win 3 matches in a row
   - [ ] Verify `current_streak: 3` and `best_streak: 3`

3. **Loss breaks streak**
   - [ ] Lose after win streak
   - [ ] Verify `current_streak: -1` and `best_streak` preserved

4. **Swiss mode**
   - [ ] Both performers get stats updated
   - [ ] Winner and loser both have incremented match counts

5. **Gauntlet mode**
   - [ ] Only champion gets stats updated
   - [ ] Defenders don't get match count incremented
   - [ ] Rank #1 defender loss is tracked

6. **Backward compatibility**
   - [ ] Performer with `elo_matches` only
   - [ ] First match migrates to `elo_stats`
   - [ ] Previous match count preserved

## Performance Impact

### Storage
- **Approach 1**: ~50 bytes per performer
- **Approach 2**: ~150 bytes per performer
- **Impact**: Still negligible (150 KB for 1000 performers)

### Processing
- Additional JSON stringify/parse operations
- Negligible performance impact for typical usage
- Same number of GraphQL mutations

## Future Enhancements

With stats tracking in place, we can now add:

### UI Enhancements
- Display win/loss record in comparison UI
- Show current streak badge
- Display confidence level based on match count
- "New" badge for performers with <10 matches

### Phase 3 Features (from research doc)
- Mode-specific stats (Swiss vs Gauntlet vs Champion)
- Recent opponents tracking
- Head-to-head records
- Rating history graphs

## Technical Reference

### GraphQL Mutation
```graphql
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
```

### Variables
```json
{
  "id": "performer-id",
  "rating": 68,
  "fields": {
    "elo_stats": "{\"total_matches\":42,\"wins\":28,\"losses\":14,\"current_streak\":5,\"best_streak\":8,\"worst_streak\":-3,\"last_match\":\"2026-01-14T18:00:00Z\"}"
  }
}
```

### Stats Object Structure
```typescript
interface EloStats {
  total_matches: number;      // Total comparisons
  wins: number;               // Number of wins
  losses: number;             // Number of losses
  current_streak: number;     // Current streak (+/-) 
  best_streak: number;        // Best win streak
  worst_streak: number;       // Worst loss streak (negative)
  last_match: string | null;  // ISO 8601 timestamp
}
```

## Troubleshooting

### Stats Not Updating

**Check:**
1. Is it a performer comparison? (Stats only for performers)
2. Is it Swiss mode? (Both should update)
3. Is it Gauntlet/Champion mode? (Only active performer updates)
4. Check browser console for errors

**Debug in console:**
```javascript
// After a comparison:
console.log(JSON.parse(currentPair.left.custom_fields.elo_stats));
console.log(JSON.parse(currentPair.right.custom_fields.elo_stats));
```

### Streak Values Incorrect

**Common Issues:**
- Streak resets when switching modes
- Stats only track within-session comparisons
- Gauntlet defenders don't update (expected)

**Verify:**
```javascript
// Check the updatePerformerStats function logic
const stats = parsePerformerEloData(performer);
console.log(`Current streak: ${stats.current_streak}`);
console.log(`Best/Worst: ${stats.best_streak}/${stats.worst_streak}`);
```

### JSON Parse Errors

**Error: "Unexpected token"**
- Stats field may be corrupted
- Manually fix in Stash UI or let next comparison overwrite

## Summary

Approach 2 provides rich statistics tracking while maintaining full backward compatibility with Approach 1. The implementation:

✅ Tracks comprehensive stats (wins, losses, streaks, timestamps)
✅ Maintains backward compatibility with match-count-only approach
✅ Handles all three comparison modes correctly
✅ Minimal performance impact
✅ Well-tested with unit tests
✅ Foundation for future analytics features

## Related Documents

- `CUSTOM_FIELDS_RESEARCH.md` - Original research and design
- `MATCH_COUNT_IMPLEMENTATION.md` - Approach 1 implementation
- `ELO_ANALYSIS.md` - ELO algorithm details
