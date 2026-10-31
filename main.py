

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
    ]

    # If the standard ones fail, fallback to US formats
    fallback_formats = [
        "%m-%d-%Y",
        "%m/%d/%Y",
    ]

    for fmt in formats + fallback_formats:

        try:

            return datetime.strptime(
                value,
                fmt
            ).date()

        except ValueError:
            continue

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

    if not os.path.exists(
        GOOGLE_CREDENTIAL_FILE
    ):

        raise RuntimeError(
            "Google service-account file not found at: "
            + GOOGLE_CREDENTIAL_FILE
        )

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]

    try:

        credentials = (
            Credentials.from_service_account_file(
                GOOGLE_CREDENTIAL_FILE,
                scopes=scopes,
            )
        )

        return gspread.authorize(
            credentials
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
