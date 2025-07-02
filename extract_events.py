import csv
import json
import re
import argparse
import sys
from collections import defaultdict

# Regex to detect performance modes inside names
MODE_PATTERN = re.compile(r"\b(B2B|B3B|F2F|VS)\b")
# Regex to strip trailing suffixes A/V or (live)
SUFFIX_PATTERN = re.compile(r"\s+(A/V|\(live\))$", re.IGNORECASE)


def parse_datetime(dt_str):
    """
    Convert a datetime string "YYYY/MM/DD HH:MM" to ISO 8601 "YYYY-MM-DDTHH:MM".
    If dt_str is empty or malformed, return an empty string.
    """
    if not dt_str or not dt_str.strip():
        return ""
    parts = dt_str.strip().split()
    if len(parts) != 2:
        return ""
    date_part, time_part = parts
    try:
        yyyy, mm, dd = date_part.split("/")
        return f"{yyyy}-{mm}-{dd}T{time_part}"
    except ValueError:
        return ""


def clean_name(name):
    """
    Remove trailing suffixes.
    """
    return SUFFIX_PATTERN.sub("", name).strip()


def detect_mode(name):
    """
    Detect B2B, B3B, F2F, VS in the name, if present.
    """
    match = MODE_PATTERN.search(name)
    return match.group(1) if match else ""


def load_csv(filepath):
    """
    Load CSV and return list of rows as dicts.
    Skips any leading comment markers “//” on lines, then locates the header row containing Start, End, Name, Location.
    """
    with open(filepath, newline="", encoding="utf-8") as csvfile:
        raw_lines = csvfile.readlines()
    # Remove leading '//' prefixes
    processed = []
    for line in raw_lines:
        stripped = line.lstrip()
        if stripped.startswith("//"):
            processed.append(stripped[2:].lstrip())
        else:
            processed.append(line)
    # Find header index
    header_idx = None
    for idx, line in enumerate(processed):
        if (
            line.strip().startswith("Start,")
            and "End" in line
            and "Name" in line
            and "Location" in line
        ):
            header_idx = idx
            break
    if header_idx is None:
        print("Error: CSV header row not found.", file=sys.stderr)
        return []
    data_lines = processed[header_idx:]
    reader = csv.DictReader(data_lines)
    events = []
    for row in reader:
        start = row.get("Start", "").strip()
        end = row.get("End", "").strip()
        name = row.get("Name", "").strip()
        stage = row.get("Location", "").strip()
        if not start or not end or not name or not stage:
            continue
        events.append({"start": start, "end": end, "name": name, "stage": stage})
    return events


def group_events(events):
    """
    Group events by (start, end, stage). If multiple artists share same slot,
    combine them into a B2B.
    """
    grouped = defaultdict(list)
    for ev in events:
        key = (ev["start"], ev["end"], ev["stage"])
        grouped[key].append(ev["name"])

    # Define all separators for B2B, x, vs, etc.
    # Regex: split on any case-insensitive B2B, B3B, F2F, VS, X, with any number of spaces around, non-capturing group
    split_regex = re.compile(r"\s*(?:B2B|B3B|F2F|VS|X|x|vs)\s*", re.IGNORECASE)

    merged = []
    for (start, end, stage), names in grouped.items():
        # Pour chaque nom dans le slot, splitter systématiquement sur les séparateurs
        for combined_name in names:
            # Exception: do not split if the name is exactly 'B2B2B2B2B'
            if combined_name.strip().lower() == 'b2b2b2b2b':
                split_artists = [clean_name(combined_name)]
            else:
                # Add ' & ' as a split separator
                split_regex = re.compile(r"\s*(?:B2B|B3B|F2F|VS|X|x|vs| & )\s*", re.IGNORECASE)
                split_artists = [clean_name(n) for n in split_regex.split(combined_name) if clean_name(n)]
            # DEBUG: print the split result for each name
            print(f"DEBUG SPLIT: '{combined_name}' -> {split_artists}")
            if len(split_artists) > 1:
                for n in split_artists:
                    merged.append({
                        "name": n,
                        "time": parse_datetime(start),
                        "end_time": parse_datetime(end),
                        "stage": stage,
                        "performance_mode": "B2B",
                        "custom_name": clean_name(combined_name),
                    })
            else:
                mode = detect_mode(combined_name)
                merged.append({
                    "name": clean_name(combined_name),
                    "time": parse_datetime(start),
                    "end_time": parse_datetime(end),
                    "stage": stage,
                    "performance_mode": mode,
                })
    return merged


def to_json(entries, output_path=None):
    """
    Serialize entries to JSON with the required schema.
    If output_path is given, write to file; else print to stdout.
    """
    output_list = []
    for e in entries:
        entry = {
            "artist_id": [],
            "name": e["name"],
            "time": e["time"],
            "end_time": e["end_time"],
            "soundcloud": "",
            "stage": e["stage"],
            "performance_mode": e["performance_mode"],
        }
        if "custom_name" in e:
            entry["custom_name"] = e["custom_name"]
        output_list.append(entry)
    json_data = json.dumps(output_list, indent=2, ensure_ascii=False)
    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(json_data)
        print(f"Saved JSON output to {output_path}")
    else:
        print(json_data)


def main():
    parser = argparse.ArgumentParser(
        description="Extract artist performances from CSV timetable to structured JSON."
    )
    parser.add_argument("csv_input", help="Path to the input CSV file")
    parser.add_argument("-o", "--output", help="Path to write JSON output (optional)")
    args = parser.parse_args()

    events = load_csv(args.csv_input)
    if not events:
        print("No valid events found. Check CSV formatting.", file=sys.stderr)
        sys.exit(1)
    merged = group_events(events)
    merged.sort(key=lambda x: (x["time"], x["stage"]))
    to_json(merged, args.output)


if __name__ == "__main__":
    main()
