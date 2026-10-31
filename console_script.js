(async () => {
    // =========================================================
    // CONFIGURATION
    // =========================================================

    const API = "https://erp-attendance-qufm.onrender.com";

    const SECTIONS = {
        "1": "313-AIAGAI-1D",
        "2": "106-AIDE-1A",
        "3": "109-AIDE-1B",
        "4": "213",
        "5": "214"
    };

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    function normalize(value) {
        return String(value || "")
            .replace(/\u200B/g, "")
            .replace(/\u00A0/g, " ")
            .replace(/\s+/g, "")
            .trim()
            .toUpperCase();
    }

    // =========================================================
    // SELECT SECTION
    // =========================================================

    const sectionChoice = prompt(
        "SELECT SECTION\n\n" +
        "1 → 313-AIAGAI-1D\n" +
        "2 → 106-AIDE-1A\n" +
        "3 → 109-AIDE-1B\n" +
        "4 → 213\n" +
        "5 → 214\n\n" +
        "Enter 1, 2, 3, 4 or 5:"
    );

    if (!sectionChoice ||
        !SECTIONS[sectionChoice.trim()]) {
        console.error("Invalid section.");
        return;
    }

    const section = SECTIONS[sectionChoice.trim()];

    // =========================================================
    // PARSE DATE IN ANY ORDER (DD-MM-YYYY, YYYY-MM-DD, etc.)
    // =========================================================

    function parseFlexibleDate(input) {
        if (!input) return null;

        const months = {
            jan: 1, january: 1,
            feb: 2, february: 2,
            mar: 3, march: 3,
            apr: 4, april: 4,
            may: 5,
            jun: 6, june: 6,
            jul: 7, july: 7,
            aug: 8, august: 8,
            sep: 9, september: 9, sept: 9,
            oct: 10, october: 10,
            nov: 11, november: 11,
            dec: 12, december: 12
        };

        const tokens = String(input)
            .trim()
            .split(/[-/.\s,]+/)
            .filter(Boolean);

        if (tokens.length !== 3) return null;

        let year = null;
        let month = null;
        let day = null;

        // Check for named month first
        const remaining = [];
        for (const token of tokens) {
            const lower = token.toLowerCase();
            if (months[lower] && month === null) {
                month = months[lower];
            } else {
                remaining.push(token);
            }
        }

        if (month !== null && remaining.length === 2) {
            const [n1, n2] = remaining.map(Number);
            if (isNaN(n1) || isNaN(n2)) return null;

            if (n1 > 31 && n2 <= 31) {
                year = n1;
                day = n2;
            } else if (n2 > 31 && n1 <= 31) {
                year = n2;
                day = n1;
            } else {
                if (n1 > 1000) { year = n1; day = n2; }
                else if (n2 > 1000) { year = n2; day = n1; }
                else { year = n2 < 100 ? (n2 > 50 ? 1900 + n2 : 2000 + n2) : n2; day = n1; }
            }
        } else if (tokens.every(t => /^\d+$/.test(t))) {
            const nums = tokens.map(Number);
            const yearIdx = nums.findIndex((n, i) => tokens[i].length === 4 || n > 31);

            if (yearIdx !== -1) {
                year = nums[yearIdx];
                if (year < 100) year += 2000;

                const others = nums.filter((_, i) => i !== yearIdx);
                const [a, b] = others;

                if (a > 12 && b <= 12) {
                    day = a;
                    month = b;
                } else if (b > 12 && a <= 12) {
                    day = b;
                    month = a;
                } else {
                    if (yearIdx === 0) {
                        month = a;
                        day = b;
                    } else {
                        day = a;
                        month = b;
                    }
                }
            } else {
                day = nums[0];
                month = nums[1];
                year = nums[2] < 100 ? (nums[2] > 50 ? 1900 + nums[2] : 2000 + nums[2]) : nums[2];
            }
        } else {
            return null;
        }

        if (!year || !month || !day) return null;

        const parsedDate = new Date(year, month - 1, day);
        if (
            parsedDate.getFullYear() !== year ||
            parsedDate.getMonth() !== month - 1 ||
            parsedDate.getDate() !== day
        ) {
            return null;
        }

        const dd = String(day).padStart(2, "0");
        const mm = String(month).padStart(2, "0");
        const yyyy = String(year);

        return `${dd}-${mm}-${yyyy}`;
    }

    // =========================================================
    // SELECT DATE
    // =========================================================

    const inputDate = prompt(
        "ENTER DATE\n\n" +
        "Accepts date in any order or format:\n" +
        "• DD-MM-YYYY (e.g. 26-10-2026)\n" +
        "• YYYY-MM-DD (e.g. 2026-10-26)\n" +
        "• MM-DD-YYYY (e.g. 10-26-2026)\n" +
        "• DD/MM/YYYY, 26 Oct 2026, etc."
    );

    if (!inputDate) {
        console.log("Cancelled.");
        return;
    }

    const date = parseFlexibleDate(inputDate);

    if (!date) {
        alert(
            "Invalid date: \"" + inputDate + "\"\n\n" +
            "Please enter a valid calendar date (e.g. 26-10-2026 or 2026-10-26)."
        );
        return;
    }

    if (!confirm(
        "ATTENDANCE AUTOMATION\n\n" +
        "Section: " + section + "\n" +
        "Date: " + date + "\n\n" +
        "Fetch attendance from the configured API?"
    )) {
        return;
    }

    console.clear();
    console.log("ERP ATTENDANCE AUTOMATION");
    console.log("Section:", section);
    console.log("Date:", date);

    // =========================================================
    // FETCH LATEST ATTENDANCE DATA
    // =========================================================

    let data;

    try {
        const url =
            API +
            "/attendance?section=" +
            encodeURIComponent(section) +
            "&date=" +
            encodeURIComponent(date) +
            "&_=" + Date.now();

        console.log("Fetching:", url);

        const response = await fetch(url, {
            method: "GET",
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache, no-store",
                "Pragma": "no-cache"
            }
        });

        const responseText = await response.text();

        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error(
                "The API returned invalid JSON:\n" +
                responseText
            );
        }

        if (!response.ok) {
            throw new Error(
                data.detail || "HTTP " + response.status
            );
        }

    } catch (error) {
        console.error("API ERROR:", error);
        alert(
            "Could not fetch attendance.\n\n" +
            error.message
        );
        return;
    }

    // =========================================================
    // VALIDATE RESPONSE
    // =========================================================

    if (
        !data.students ||
        typeof data.students !== "object" ||
        Array.isArray(data.students)
    ) {
        console.error("Invalid API response:", data);
        alert(
            "The API response does not contain a valid " +
            "students object. Check the backend."
        );
        return;
    }

    if (
        data.section &&
        data.section !== section
    ) {
        alert(
            "Section mismatch!\nExpected: " + section +
            "\nReceived: " + data.section +
            "\nNo attendance was changed."
        );
        return;
    }

    console.log("Fetched at:", data.fetched_at);
    console.log("Student count:", data.student_count);
    console.log("Selected column:", data.selected_column_index);

    // =========================================================
    // BUILD ATTENDANCE MAP
    // =========================================================

    const attendance = new Map();

    for (const [regNo, status] of Object.entries(data.students)) {
        const registration = normalize(regNo);
        const value = String(status).trim().toLowerCase();

        if (!registration) continue;

        if (value === "present") {
            attendance.set(registration, "Present");
        } else if (value === "absent") {
            attendance.set(registration, "Absent");
        } else {
            console.warn(
                "Ignoring unrecognized attendance status:",
                regNo,
                status
            );
        }
    }

    console.table(
        [...attendance].map(([registration, status]) => ({
            Registration: registration,
            Attendance: status
        }))
    );

    if (attendance.size === 0) {
        alert(
            "No valid Present/Absent records were returned.\n" +
            "Nothing was changed."
        );
        return;
    }

    // =========================================================
    // FIND STUDENT IN ERP
    // =========================================================

    function findStudent(registration) {
        const elements = document.querySelectorAll(
            "p, span, td, div"
        );

        for (const element of elements) {
            if (
                normalize(element.textContent) === registration
            ) {
                return element;
            }
        }

        return null;
    }

    // =========================================================
    // FIND PRESENT / ABSENT BUTTONS
    // =========================================================

    function findButtons(student) {
        let container = student;

        for (let level = 0; level < 10; level++) {
            if (!container) break;

            const buttons = [
                ...container.querySelectorAll("button")
            ];

            const present = buttons.find(button =>
                normalize(button.textContent) === "PRESENT"
            );

            const absent = buttons.find(button =>
                normalize(button.textContent) === "ABSENT"
            );

            if (present || absent) {
                return { present, absent };
            }

            container = container.parentElement;
        }

        return null;
    }

    // =========================================================
    // CHECK CURRENT BUTTON STATE
    // =========================================================

    function isActive(button) {
        if (!button) return false;

        const className = String(button.className || "")
            .toLowerCase();

        return (
            className.includes("active") ||
            className.includes("selected") ||
            className.includes("checked") ||
            button.getAttribute("aria-pressed") === "true" ||
            button.getAttribute("aria-checked") === "true"
        );
    }

    // =========================================================
    // PREVIEW BEFORE MARKING
    // =========================================================

    const preview = {
        Section: section,
        Date: date,
        Records: attendance.size,
        Present: [...attendance.values()].filter(
            value => value === "Present"
        ).length,
        Absent: [...attendance.values()].filter(
            value => value === "Absent"
        ).length
    };

    console.table([preview]);

    if (!confirm(
        "VERIFY ATTENDANCE BEFORE CONTINUING\n\n" +
        "Section: " + section + "\n" +
        "Date: " + date + "\n" +
        "Records: " + attendance.size + "\n" +
        "Present: " + preview.Present + "\n" +
        "Absent: " + preview.Absent + "\n\n" +
        "Continue only if these values are correct."
    )) {
        console.log("Cancelled before marking.");
        return;
    }

    // =========================================================
    // PROCESS STUDENTS
    // =========================================================

    let markedPresent = 0;
    let markedAbsent = 0;
    let alreadyCorrect = 0;
    let skipped = 0;
    let failed = 0;

    const skippedStudents = [];
    const failedStudents = [];

    let counter = 0;

    for (const [registration, desiredStatus] of attendance) {
        counter++;

        console.log(
            `[${counter}/${attendance.size}]`,
            registration,
            "→",
            desiredStatus
        );

        try {
            const student = findStudent(registration);

            if (!student) {
                console.warn(
                    "Student not found:", registration
                );
                skippedStudents.push(registration);
                skipped++;
                continue;
            }

            const buttons = findButtons(student);

            if (!buttons) {
                console.warn(
                    "Attendance buttons not found:",
                    registration
                );
                skippedStudents.push(registration);
                skipped++;
                continue;
            }

            const target =
                desiredStatus === "Present"
                    ? buttons.present
                    : buttons.absent;

            if (!target) {
                console.warn(
                    "Target button missing:",
                    registration,
                    desiredStatus
                );
                skippedStudents.push(registration);
                skipped++;
                continue;
            }

            if (isActive(target)) {
                console.log(
                    "Already correct:", registration
                );
                alreadyCorrect++;
                continue;
            }

            student.scrollIntoView({
                behavior: "instant",
                block: "center"
            });

            await sleep(250);

            target.click();

            await sleep(600);

            if (desiredStatus === "Present") {
                markedPresent++;
            } else {
                markedAbsent++;
            }

            console.log(
                "Clicked:", registration, desiredStatus
            );

            await sleep(250);

        } catch (error) {
            console.error(
                "Failed:", registration, error
            );

            failedStudents.push(registration);
            failed++;
        }
    }

    // =========================================================
    // FINAL REPORT
    // =========================================================

    console.log("==========================================");
    console.log("ATTENDANCE AUTOMATION FINISHED");
    console.log("==========================================");

    console.table([{
        Section: section,
        Date: date,
        "Sheet Records": attendance.size,
        "Marked Present": markedPresent,
        "Marked Absent": markedAbsent,
        "Already Correct": alreadyCorrect,
        Skipped: skipped,
        Failed: failed
    }]);

    if (skippedStudents.length) {
        console.warn("SKIPPED STUDENTS:", skippedStudents);
    }

    if (failedStudents.length) {
        console.error("FAILED STUDENTS:", failedStudents);
    }

    alert(
        "Attendance automation finished.\n\n" +
        "Section: " + section + "\n" +
        "Date: " + date + "\n\n" +
        "Marked Present: " + markedPresent + "\n" +
        "Marked Absent: " + markedAbsent + "\n" +
        "Already Correct: " + alreadyCorrect + "\n" +
        "Skipped: " + skipped + "\n" +
        "Failed: " + failed + "\n\n" +
        "Please verify the ERP records manually."
    );
})();
