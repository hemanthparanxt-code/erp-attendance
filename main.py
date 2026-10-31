

import json
import os
import re
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# CONFIGURATION
# ============================================================

SPREADSHEET_ID = "1CLypwiG9hb-zMNmZzvPp2VlB3XgWmJq69f5lpRgQQuE"

SECTION_SHEETS = {
    "313-AIAGAI-1D": "313-AIAGAI-1D",
    "106-AIDE-1A": "106-AIDE-1A",
    "109-AIDE-1B": "109-AIDE-1B",
    "213": "213",
    "214": "214",
}

GOOGLE_CREDENTIAL_FILE = (
    "/etc/secrets/google-service-account.json"
)


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="ERP Attendance Automation API",
    version="1.1.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


# ============================================================
# HELPERS
# ============================================================

def clean(value):
    if value is None:
        return ""

    return str(value).strip()


def normalize_registration(value):
    return re.sub(
        r"\s+",
        "",
        clean(value).upper()
    )


def normalize_status(value):

    value = clean(value).lower()

    present_values = {
        "present",
        "p",
        "yes",
        "y",
        "1",
        "true",
    }

    absent_values = {
        "absent",
        "a",
        "no",
        "n",
        "0",
        "false",
    }

    if value in present_values:
        return "Present"

    if value in absent_values:
        return "Absent"

    return None


# ============================================================
# DATE PARSING
# ============================================================

def parse_date(value):

    value = clean(value)

    if not value:
        return None

    formats = [
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d.%m.%Y",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y.%m.%d",
        "%m-%d-%Y",
        "%m/%d/%Y",
        "%m.%d.%Y",
        "%d-%b-%Y",
        "%d/%b/%Y",
        "%d %b %Y",
        "%d-%B-%Y",
        "%d %B %Y",
        "%b %d, %Y",
        "%b %d %Y",
        "%B %d, %Y",
        "%B %d %Y",
        "%Y-%b-%d",
        "%Y/%b/%d",
        "%Y %b %d",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(
                value,
                fmt
            ).date()
        except ValueError:
            continue

    # Fallback: intelligent token parser for any arbitrary date order
    try:
        month_names = {
            "jan": 1, "january": 1,
            "feb": 2, "february": 2,
            "mar": 3, "march": 3,
            "apr": 4, "april": 4,
            "may": 5,
            "jun": 6, "june": 6,
            "jul": 7, "july": 7,
            "aug": 8, "august": 8,
            "sep": 9, "september": 9, "sept": 9,
            "oct": 10, "october": 10,
            "nov": 11, "november": 11,
            "dec": 12, "december": 12,
        }

        tokens = [t for t in re.split(r"[-/.\s,]+", value) if t]
        if len(tokens) == 3:
            year, month, day = None, None, None
            remaining = []
            for t in tokens:
                lower = t.lower()
                if lower in month_names and month is None:
                    month = month_names[lower]
                else:
                    remaining.append(t)

            if month is not None and len(remaining) == 2 and all(r.isdigit() for r in remaining):
                n1, n2 = int(remaining[0]), int(remaining[1])
                if n1 > 31 and n2 <= 31:
                    year, day = n1, n2
                elif n2 > 31 and n1 <= 31:
                    year, day = n2, n1
                elif n1 > 1000:
                    year, day = n1, n2
                elif n2 > 1000:
                    year, day = n2, n1
                else:
                    year = 1900 + n2 if n2 > 50 else 2000 + n2
                    day = n1
            elif all(t.isdigit() for t in tokens):
                nums = [int(t) for t in tokens]
                year_idx = next((i for i, (n, t) in enumerate(zip(nums, tokens)) if len(t) == 4 or n > 31), None)
                if year_idx is not None:
                    year = nums[year_idx]
                    if year < 100:
                        year += 2000
                    others = [n for i, n in enumerate(nums) if i != year_idx]
                    a, b = others[0], others[1]
                    if a > 12 and b <= 12:
                        day, month = a, b
                    elif b > 12 and a <= 12:
                        day, month = b, a
                    elif year_idx == 0:
                        month, day = a, b
                    else:
                        day, month = a, b
                else:
                    day, month, year = nums[0], nums[1], nums[2]
                    if year < 100:
                        year = 1900 + year if year > 50 else 2000 + year

            if year and month and day:
                from datetime import date as date_type
                return date_type(year, month, day)
    except Exception:
        pass

    return None


def normalize_date(value):

    parsed = parse_date(value)

    if parsed is None:
        return clean(value)

    return parsed.strftime(
        "%d-%m-%Y"
    )


# ============================================================
# GOOGLE AUTHENTICATION
# ============================================================

def get_google_client():

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]

    try:
        # 1. Try reading from environment variable GOOGLE_SERVICE_ACCOUNT_JSON
        env_credentials = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if env_credentials:
            service_account_info = json.loads(env_credentials)
            credentials = Credentials.from_service_account_info(
                service_account_info,
                scopes=scopes,
            )
            return gspread.authorize(credentials)

        # 2. Try reading from secret file / local file
        candidate_paths = [
            GOOGLE_CREDENTIAL_FILE,
            "google-service-account.json",
            "credentials.json",
        ]

        found_path = next((p for p in candidate_paths if os.path.exists(p)), None)

        if found_path:
            credentials = Credentials.from_service_account_file(
                found_path,
                scopes=scopes,
            )
            return gspread.authorize(credentials)

        raise RuntimeError(
            "Google service-account credentials not found. "
            "Please either add a Secret File at '/etc/secrets/google-service-account.json' "
            "or set the 'GOOGLE_SERVICE_ACCOUNT_JSON' environment variable in your Render dashboard."
        )

    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON environment variable as JSON: "
            + str(error)
        )
    except Exception as error:
        raise RuntimeError(
            "Google authentication failed: "
            + str(error)
        )


# ============================================================
# OPEN WORKSHEET
# ============================================================

def get_worksheet(section):

    if section not in SECTION_SHEETS:

        raise ValueError(
            "Unknown section: "
            + section
        )

    worksheet_name = SECTION_SHEETS[
        section
    ]

    try:

        # IMPORTANT:
        # A new Google client is created for every request.
        # Nothing is stored globally.

        client = get_google_client()

        spreadsheet = client.open_by_key(
            SPREADSHEET_ID
        )

        worksheet = spreadsheet.worksheet(
            worksheet_name
        )

        return worksheet

    except gspread.exceptions.WorksheetNotFound:

        raise ValueError(
            f"Google Sheet tab '{worksheet_name}' "
            f"was not found."
        )

    except Exception as error:

        raise RuntimeError(
            f"Could not open worksheet "
            f"'{worksheet_name}': {error}"
        )


# ============================================================
# FIND REGISTRATION COLUMN
# ============================================================

def find_registration_column(headers):

    possible_names = {
        "registration no",
        "registration number",
        "registration",
        "reg no",
        "reg number",
        "regno",
        "roll no",
        "roll number",
        "rollno",
        "admission no",
        "admission number",
    }

    # Exact match

    for index, header in enumerate(headers):

        normalized = clean(
            header
        ).lower()

        if normalized in possible_names:

            return index

    # Partial match

    for index, header in enumerate(headers):

        normalized = clean(
            header
        ).lower()

        if (
            "registration" in normalized
            or "reg no" in normalized
            or "regno" in normalized
            or "roll no" in normalized
            or "rollno" in normalized
            or "admission no" in normalized
        ):

            return index

    return None


# ============================================================
# FIND ALL DATE COLUMNS
# ============================================================

def find_date_columns(
    headers,
    requested_date,
):

    requested = parse_date(
        requested_date
    )

    if requested is None:
        return []

    matches = []

    for index, header in enumerate(headers):

        header_date = parse_date(
            header
        )

        if header_date == requested:

            matches.append(index)

    return matches




# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "status": "online",
        "service": "ERP Attendance Automation API",
        "version": "1.1.0",
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy"
    }


# ============================================================
# SECTIONS
# ============================================================

@app.get("/sections")
def sections():

    return {
        "sections": list(
            SECTION_SHEETS.keys()
        )
    }


# ============================================================
# DIAGNOSTIC
# ============================================================

@app.get("/diagnostic")
def diagnostic():

    result = {
        "api": "OK",
        "google_auth": False,
        "spreadsheet": False,
        "worksheets": [],
    }

    try:

        client = get_google_client()

        result[
            "google_auth"
        ] = True

        spreadsheet = client.open_by_key(
            SPREADSHEET_ID
        )

        result[
            "spreadsheet"
        ] = True

        worksheets = (
            spreadsheet.worksheets()
        )

        result[
            "worksheets"
        ] = [
            {
                "title": sheet.title,
                "id": sheet.id,
            }

            for sheet in worksheets
        ]

        return result

    except Exception as error:

        result[
            "error"
        ] = str(error)

        return result


# ============================================================
# ATTENDANCE
# ============================================================

@app.get("/attendance")
def attendance(
    section: str,
    date: str,
    response: Response,
):

    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    try:

        if section not in SECTION_SHEETS:
            raise ValueError(
                f"Invalid section: {section}"
            )

        worksheet = get_worksheet(section)

        # ----------------------------------------------------
        # FORCE A FRESH READ FROM GOOGLE SHEETS
        # ----------------------------------------------------

        rows = worksheet.get_values(
            value_render_option="FORMATTED_VALUE"
        )

        fetched_at = datetime.now(
            timezone.utc
        ).isoformat()

        if not rows:
            raise ValueError(
                "Google Sheet returned no rows."
            )

        headers = rows[0]

        # ----------------------------------------------------
        # FIND REGISTRATION COLUMN
        # ----------------------------------------------------

        registration_column = find_registration_column(
            headers
        )

        if registration_column is None:
            raise ValueError(
                "Registration column not found."
            )

        # ----------------------------------------------------
        # FIND ALL MATCHING DATE COLUMNS
        # ----------------------------------------------------

        date_columns = find_date_columns(
            headers,
            date
        )

        if not date_columns:
            raise ValueError(
                f"Date '{date}' not found."
            )

        # SMARTEST MATCHING DATE: Check which date column actually has data
        selected_column = date_columns[-1]
        best_data_count = -1
        
        for col in reversed(date_columns):
            data_count = 0
            for row in rows[1:]:
                if col < len(row) and normalize_status(row[col]):
                    data_count += 1
            if data_count > best_data_count:
                best_data_count = data_count
                selected_column = col

        # ----------------------------------------------------
        # READ STUDENTS
        # ----------------------------------------------------

        students = {}

        for row in rows[1:]:

            if registration_column >= len(row):
                continue

            registration = normalize_registration(
                row[registration_column]
            )

            if not registration:
                continue

            if selected_column >= len(row):
                continue

            status = normalize_status(
                row[selected_column]
            )

            if status:
                students[registration] = status

        # ----------------------------------------------------
        # DEBUG INFORMATION
        # ----------------------------------------------------

        return {
            "status": "success",

            "section": section,

            "worksheet": worksheet.title,

            "date_requested": date,

            "fetched_at": fetched_at,

            "total_rows_read": len(rows),

            "total_columns_read": len(headers),

            "registration_column": registration_column,

            "matching_date_columns": date_columns,

            "selected_date_column": selected_column,

            "selected_column_index": selected_column,

            "actual_selected_header":
                headers[selected_column],

            "student_count": len(students),

            "students": students,

            # Show first 5 rows so we can verify
            # exactly what Google returned.
            "debug_first_rows": rows[1:6],
        }

    except Exception as error:

        print(
            "ATTENDANCE ERROR:",
            repr(error)
        )

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
