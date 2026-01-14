# Custom Fields Research - Executive Summary

## Question
"Can you research using custom fields to help with tracking matches for the ELO ranking system?"

## Answer: Yes! ✅

Stash's custom fields functionality can be used to track match data for the ELO ranking system. Here's what you need to know:

## What Custom Fields Can Do

### Available Through Stash
- **Field**: `details` (JSON storage on performers)
- **Access**: GraphQL API (read/write)
- **Format**: JSON object with `custom` section
- **Limitation**: No server-side filtering (must filter client-side)

### What You Can Track
1. **Match Count** - How many comparisons each performer has participated in
2. **Win/Loss Records** - Individual match outcomes
3. **Win Streaks** - Current and historical winning streaks
4. **Mode-Specific Stats** - Performance in Swiss vs Gauntlet vs Champion modes
5. **Recent Opponents** - Prevent repeat matchups
6. **Rating History** - Track rating changes over time
7. **Timestamps** - When comparisons occurred

## Current State

### What's Already Stored
- ✅ ELO rating (in `rating100` field)

### What's NOT Currently Stored
- ❌ Match count
- ❌ Win/loss records
- ❌ Match history
- ❌ Any comparison metadata

All match data currently exists only in browser memory during a session and is lost when the page reloads.

## Recommendations

### 🎯 Recommended: Start with Match Count Tracking

**Why?**
1. Improves the K-factor algorithm (currently uses rating as a proxy for experience)
2. Simple to implement (low risk)
3. Minimal performance impact
4. Foundation for future enhancements

**Benefits:**
- New performers stabilize faster (K=16 for <10 matches)
- Established ratings more protected (K=8 for >50 matches)
- More accurate than current rating-based heuristic

### 📊 Future Enhancement: Statistics Tracking

**Add later:**
- Win/loss records
- Win streaks
- Last match timestamp
- Display stats in UI

### 🔮 Optional: Comprehensive History

**Consider much later:**
- Recent opponent tracking (avoid rematches)
- Mode-specific performance stats
- Analytics dashboard

## Implementation Impact

### Storage
- **Minimal approach**: ~50 bytes per performer
- **For 100 performers**: ~5 KB total
- **For 1000 performers**: ~50 KB total
- **Verdict**: Negligible impact

### Performance
- **Query impact**: Adds `details` field to existing queries
- **Mutation impact**: Same number of updates, slightly larger payload
- **Verdict**: Minimal impact for typical usage

### Backward Compatibility
- ✅ Works with existing ratings
- ✅ Preserves existing text in `details` field
- ✅ Graceful degradation for performers without custom fields
- ✅ No database schema changes required

## What to Do Next

### Option 1: Read the Full Research
See **[CUSTOM_FIELDS_RESEARCH.md](./CUSTOM_FIELDS_RESEARCH.md)** for:
- Complete implementation details
- Code examples for all three approaches
- Migration strategy
- Testing recommendations
- Performance analysis

### Option 2: Implement Match Count Tracking
The research document includes complete code for:
- Parsing custom fields from `details` JSON
- Updating match counts after comparisons
- Enhanced K-factor calculation using match counts
- Testing strategy

### Option 3: Discuss First
Consider:
- Which approach fits your goals?
- Do you want stats visible in the UI?
- Should this be a separate feature/PR?
- Any concerns about complexity?

## Quick Start: Match Count Implementation

If you want to implement match count tracking, here's the overview:

### 1. Add `details` to GraphQL queries
```javascript
const PERFORMER_FRAGMENT = `
  id
  name
  rating100
  details  // <-- Add this
  ...
`;
```

### 2. Parse match count from details
```javascript
function parsePerformerEloData(performer) {
  if (!performer.details) return { matches: 0 };
  const detailsObj = JSON.parse(performer.details);
  return {
    matches: detailsObj?.custom?.elo_matches || 0
  };
}
```

### 3. Use match count in K-factor
```javascript
function getKFactor(rating, matchCount) {
  if (matchCount < 10) return 16;  // New
  if (matchCount < 30) return 12;  // Moderate
  return 8;                         // Established
}
```

### 4. Update match count after comparisons
```javascript
// After each comparison, increment both performers' match counts
input.details = JSON.stringify({
  custom: { elo_matches: currentMatches + 1 }
});
```

See the full research document for complete implementation details.

## Files in This Research

1. **CUSTOM_FIELDS_RESEARCH.md** - Complete detailed research (22 KB)
   - All three implementation approaches
   - Complete code examples
   - Testing and migration strategies

2. **CUSTOM_FIELDS_SUMMARY.md** - This executive summary
   - Quick overview
   - Key recommendations
   - Next steps

3. **ELO_ANALYSIS.md** - Original ELO algorithm analysis (13 KB)
   - Current implementation review
   - Identified issues
   - Mathematical analysis

4. **IMPLEMENTATION_SUMMARY.md** - Recent ELO improvements (7 KB)
   - Zero-sum fix
   - Dynamic K-factor (rating-based)
   - Adaptive Swiss matching

## Questions or Concerns?

The research is complete and comprehensive. The recommendation is to start with **Approach 1: Match Count Only** as it provides the most value with the least complexity.

Feel free to:
- Review the detailed research document
- Ask questions about any approach
- Request implementation assistance
- Discuss trade-offs between approaches

---

**Status**: ✅ Research Complete - Ready for Implementation Decision
