# How to Use the New Filter Features

This guide explains how to use the three new filter enhancements in the HotOrNot plugin.

## 1. Gender Filter

### What it does
Allows you to filter performers by gender when using HotOrNot.

### How to use it

**In Stash UI:**
1. Navigate to the Performers page
2. Click the filter icon
3. Select "Gender" filter
4. Choose a modifier:
   - **INCLUDES** - Only show performers with this gender
   - **EXCLUDES** - Hide performers with this gender
5. Select gender value (MALE, FEMALE, etc.)
6. Apply the filter
7. Open HotOrNot (🔥 button) - it will only show performers matching your gender filter

**Example URLs:**
```
# Show only female performers
/performers?c=("type":"gender","modifier":"INCLUDES","value":"FEMALE")

# Exclude male performers (default behavior, now customizable)
/performers?c=("type":"gender","modifier":"EXCLUDES","value":"MALE")

# Show only non-binary performers
/performers?c=("type":"gender","modifier":"INCLUDES","value":"NON_BINARY")
```

### Before vs After
- **Before:** Gender was hardcoded to exclude males, couldn't be changed
- **After:** You can filter by any gender with full control

## 2. Rating BETWEEN Modifier

### What it does
Allows you to filter performers by a rating range instead of a single value.

### How to use it

**In Stash UI:**
1. Navigate to the Performers page
2. Click the filter icon
3. Select "Rating" filter
4. Choose "BETWEEN" as the modifier
5. Enter two values (e.g., 20 and 30)
6. Apply the filter
7. Open HotOrNot (🔥 button) - it will only show performers with ratings between those values

**Example URLs:**
```
# Show performers rated between 20-30
/performers?c=("type":"rating100","modifier":"BETWEEN","value":("value":20,"value2":30))

# Show performers rated between 50-80
/performers?c=("type":"rating100","modifier":"BETWEEN","value":("value":50,"value2":80))

# Show performers rated between 70-100 (highly rated only)
/performers?c=("type":"rating100","modifier":"BETWEEN","value":("value":70,"value2":100))
```

### Use Cases
- **Find mid-tier performers:** Rating between 40-60
- **Compare highly-rated only:** Rating between 80-100
- **Focus on unrated/low-rated:** Rating between 0-30
- **Narrow down rankings:** Rating between 45-55 to make fine adjustments

### Before vs After
- **Before:** Could only filter by EQUALS, GREATER_THAN, LESS_THAN
- **After:** Can filter by exact ranges using BETWEEN

## 3. Country Filter (Fixed)

### What it does
Filters performers by their country field. This was broken before due to inconsistent value parsing.

### How to use it

**In Stash UI:**
1. Navigate to the Performers page
2. Click the filter icon
3. Select "Country" filter
4. Choose a modifier (usually EQUALS)
5. Enter a country name
6. Apply the filter
7. Open HotOrNot (🔥 button) - it will only show performers from that country

**Example URLs:**
```
# Show performers from United States
/performers?c=("type":"country","modifier":"EQUALS","value":("value":"United States"))

# Show performers from Canada
/performers?c=("type":"country","modifier":"EQUALS","value":"Canada")

# Show performers from Japan
/performers?c=("type":"country","modifier":"EQUALS","value":"Japan")
```

### Before vs After
- **Before:** Country filter didn't work reliably
- **After:** Works with both nested and direct value formats

## Combining Filters

You can combine multiple filters together by applying them one at a time in the Stash UI. The plugin will respect all active filters.

### Example Workflow

**Scenario:** You want to compare only highly-rated female performers from the United States.

1. Go to Performers page
2. Apply Gender filter: INCLUDES FEMALE
3. Apply Rating filter: BETWEEN 70-100
4. Apply Country filter: EQUALS United States
5. Open HotOrNot
6. The plugin will only show performers matching ALL three filters

The active filters will be displayed in the HotOrNot UI with a blue badge showing:
```
🔍 Active Filters: Gender includes FEMALE, Rating between 70-100, Country is United States
```

## Technical Details

### Filter Format
All filters use Stash's custom serialization format:
```
("key":"value","key2":"value2")
```

This gets converted to standard JSON internally:
```json
{"key":"value","key2":"value2"}
```

### GraphQL Filter Structure

**Gender:**
```javascript
{
  gender: {
    value: "FEMALE",
    modifier: "INCLUDES"
  }
}
```

**Rating BETWEEN:**
```javascript
{
  rating100: {
    value: 20,
    value2: 30,
    modifier: "BETWEEN"
  }
}
```

**Country:**
```javascript
{
  country: {
    value: "United States",
    modifier: "EQUALS"
  }
}
```

## Troubleshooting

### Gender filter not working
- Make sure you've applied the filter on the Performers page BEFORE opening HotOrNot
- Check the browser console for "[HotOrNot] Applied gender filter" message
- Verify the filter badge shows in the HotOrNot UI

### BETWEEN modifier not working
- Ensure both values are numbers between 0-100
- Check that value is less than value2
- Look for console warnings about invalid rating values

### Country filter not working
- Try refreshing the page after applying the filter
- Check the exact spelling of the country name
- Look for console logs confirming the filter was applied

### No performers showing up
- Your filter combination might be too restrictive
- Try removing filters one by one to see which is causing the issue
- Check that you have performers matching your criteria in your library

## Examples

### Example 1: Rate only new performers
```
Filter: Rating BETWEEN 0-40
Goal: Focus on performers who need more comparisons
```

### Example 2: Refine top tier
```
Filter: Rating BETWEEN 85-95
Goal: Fine-tune rankings among highly-rated performers
```

### Example 3: Focus on specific region
```
Filter: Country = "Japan"
Goal: Compare performers from a specific country
```

### Example 4: Find the best in a category
```
Filters:
- Gender INCLUDES FEMALE
- Rating BETWEEN 90-100
- Country = "United States"
Goal: Compare only the highest-rated female US performers
```

## Limitations

- Only one filter of each type can be active at a time
- Filters are read when HotOrNot modal opens, not updated dynamically
- Some filter types (like tags, studios) are supported but not documented here
- Images mode doesn't support all filters (only basic rating/date filters)

## See Also

- [FILTER_ENHANCEMENT_SUMMARY.md](FILTER_ENHANCEMENT_SUMMARY.md) - Technical implementation details
- [ACTIVE_FILTER_IMPLEMENTATION.md](ACTIVE_FILTER_IMPLEMENTATION.md) - Original filter system documentation
- [test_new_filters.html](test_new_filters.html) - Interactive test page for validating filters
