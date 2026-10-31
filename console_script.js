(async () => {
    // =========================================================
    // CONFIGURATION
    // =========================================================

    const API = "https://erp-plan.onrender.com";

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
    // SELECT DATE
    // =========================================================

    const date = prompt(
        "ENTER DATE\n\n" +
        "Format: DD-MM-YYYY\n" +
        "Example: 26-10-2026"
    );

    if (!date) {
        console.log("Cancelled.");
        return;
    }

    if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) {
        alert("Invalid date format. Use DD-MM-YYYY.");
        return;
    }

    const [day, month, year] = date.split("-").map(Number);
    const parsedDate = new Date(year, month - 1, day);

    if (
        parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() !== month - 1 ||
        parsedDate.getDate() !== day
    ) {
        alert("Invalid calendar date.");
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
