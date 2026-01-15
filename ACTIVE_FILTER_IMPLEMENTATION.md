# Active Filter Reading Implementation

## Overview

The HotOrNot plugin can now read and respect active filters from the Stash Performers and Images pages. This allows users to apply filters (e.g., "Created At is greater than 2026-01-12") and have the plugin only select items that match those filters for comparison.

## Implementation Approach

After reviewing three potential approaches for reading active filters, we implemented a **hybrid solution** that combines the most reliable methods:

### 1. Primary: URL Parameter Parsing (Most Reliable)

The plugin reads the `c` parameter from the URL, which contains filter criteria in Stash's custom serialization format.

**How it works:**
- Stash stores filter state in URL parameter `c` (e.g., `?c=(%22type%22:%22created_at%22,%22modifier%22:%22GREATER_THAN%22,%22value%22:(%22value%22:%222026-01-12%2000:00%22))`)
- The plugin parses this custom format (uses colons and parentheses instead of standard JSON)
- Converts it to a usable JavaScript object

**Advantages:**
- Programmatic access to exact filter criteria
- Reliable and deterministic
- Works even if UI changes

**Implementation functions:**
- `parseStashFilterParam()` - Converts Stash's custom format to JSON
- `readFiltersFromURL()` - Reads and parses the `c` parameter

### 2. Secondary: DOM Scraping (Visual Confirmation)

The plugin also reads filter chips from the DOM for human-readable filter descriptions.

**How it works:**
- Targets `.filter-item-list .btn-secondary` elements
- Extracts text content from filter chips (e.g., "Created At is greater than 2026-01-12 00:00")
- Displays these in the UI for user confirmation

**Advantages:**
- Shows exactly what the user sees
- Good for debugging and user feedback
- Provides human-readable filter descriptions

**Implementation functions:**
- `readFiltersFromDOM()` - Scrapes filter chip elements

### 3. Not Implemented: Apollo Client Cache Access

We decided **not to implement** direct access to Apollo Client cache because:
- Too intrusive and brittle (relies on internal implementation details)
- High risk of breaking with Stash updates
- The URL and DOM approaches provide sufficient reliability

## Key Functions

### `getActiveFilters()`
Main entry point that combines URL parsing and DOM scraping.

```javascript
const filters = getActiveFilters();
// Returns:
// {
//   criteria: { /* parsed filter object */ },
//   descriptions: ["Created At is greater than 2026-01-12"],
//   hasFilters: true
// }
```

### `convertToPerformerFilter(activeFilters)`
Converts active page filters to GraphQL-compatible performer filter format.

**Currently supports:**
- `created_at` filters - Date/timestamp comparisons
- `rating100` filters - Numeric rating comparisons
- `birthdate` filters - Birthdate comparisons
- `tags` filters - Tag inclusion/exclusion
- `studios` filters - Studio filtering
- `ethnicity` filters - Ethnicity matching
- `country` filters - Country matching

**Filter modifiers supported:**
- `EQUALS` - Exact match
- `GREATER_THAN` - Greater than comparison
- `LESS_THAN` - Less than comparison
- `INCLUDES` - Contains/includes
- `EXCLUDES` - Does not contain/excludes
- `INCLUDES_ALL` - Includes all specified values

Can be extended to support additional filter types as needed.

### `getPerformerFilter(respectPageFilters = true)`
Updated to optionally incorporate active page filters into the performer query.

- When `respectPageFilters = true` (default), merges page filters with plugin defaults
- When `respectPageFilters = false`, uses only plugin defaults (exclude males, exclude without images)

## User Experience

### Active Filter Display
When filters are active on the page, the plugin displays a badge showing:
- 🔍 Icon
- "Active Filters: [filter descriptions]"
- Styled with blue theme to indicate filters are in effect

### Filter Behavior
- Plugin automatically detects and respects active filters
- Only shows performers/images that match the current page filters
- Combines page filters with plugin's default filters (e.g., exclude males)

## Technical Details

### URL Parameter Format
Stash uses a custom serialization format:
```
Original: {"type":"created_at","modifier":"GREATER_THAN","value":{"value":"2026-01-12 00:00"}}
Stash format: ("type":"created_at","modifier":"GREATER_THAN","value":("value":"2026-01-12 00:00"))
```

Our parser converts parentheses to braces and parses as JSON.

### Filter Merging
Active filters are merged with plugin defaults:
1. Start with plugin defaults (exclude males, exclude without images)
2. Add filter criteria from URL parameter
3. Pass combined filter to GraphQL query

### Error Handling
- If filter parsing fails, falls back to defaults
- Console warnings for debugging
- Never breaks the plugin functionality

## Future Enhancements

Potential improvements:
1. Support for more filter types (tags, studios, etc.)
2. UI toggle to enable/disable filter respect
3. Display count of items matching filters
4. Advanced filter combination logic

## Testing Recommendations

To test the filter reading:
1. Go to Performers page in Stash
2. Apply a filter (e.g., Created At, Rating, etc.)
3. Open HotOrNot plugin
4. Verify the filter badge appears
5. Verify only filtered performers appear in comparisons
6. Check browser console for filter parsing logs

## Code Location

All filter reading code is in `/plugins/hotornot/hotornot.js`:
- Lines ~985-1220: Filter reading utilities (parseStashFilterParam, readFiltersFromURL, readFiltersFromDOM, getActiveFilters, convertToPerformerFilter)
- Lines ~1230-1255: Updated `getPerformerFilter()` function with filter merging logic
- Lines ~2293-2360: UI with filter badge in createMainUI()

CSS styles in `/plugins/hotornot/hotornot.css`:
- Lines ~32-48: Active filter badge styles
