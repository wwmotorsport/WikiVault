# Wikivault: School (in development)

This part of Wikivault is still being built. It is switched off in the released app (`"wikivault": { "features": { "school": false } }` in `package.json`) and is developed on the `school` branch, where it is on. This page describes it as it stands there.

## School: Grade 5

The open-book button in the top bar opens a full year of Grade 5, arranged as 36 weeks of five days in two semesters. The lessons are the Core Knowledge Foundation's free curriculum, used as published:

| Subject | Series | About a day | What is in the files |
|---|---|---|---|
| Language Arts | Core Knowledge Language Arts (CKLA) | 90 minutes | Teacher guides with every lesson, readers, activity books, tests and answer keys |
| Mathematics | Core Knowledge Mathematics (CKMath), built on Illustrative Mathematics' IM K-5 Math | 60 minutes | Teacher guides with lesson plans and answers, student workbooks, unit tests |
| History and Geography | Core Knowledge History and Geography (CKHG) | 45 minutes | Student readers, teacher guides with questions, tests and answer keys |
| Science | Core Knowledge Science (CKSci) | 45 minutes | Student readers, teacher guides with investigations, tests and answer keys |

Visual Arts and Music are not included yet.

**Before downloading.** The plan is part of the app. The week, the year and the list of what to buy can all be read straight away; only the links into the books wait for the files.

**Downloading.** *Download the Grade 5 files* fetches 105 PDF files (about 710 MB) from coreknowledge.org into `<library>\school\`. If the line above the tabs says a file could not be downloaded, press Download again; it fetches only what is missing. It needs Wikipedia to be set up first and at least 4 GB free. It can be cancelled and continued later; files already fetched are kept. Afterwards the app reads every page of every file once, in the background, so the books can be searched and opened at the right page. The line above the tabs shows how far it is and, at the end, the real size.

**Guided lessons.** Every lesson in the week has a **Start lesson** button. It opens the lesson as a list of steps on the left with the book on the right:

1. *Get ready*: the first page of the lesson in the teacher guide, which says what the lesson is for and what it needs.
2. The parts of the lesson, in the order and with the times the guide gives them. In mathematics that is a warm-up, one to three activities, a lesson synthesis and a cool-down. In language arts it is the reading, writing, grammar and other parts, with the timed activities inside each. In history it is the introduction, the guided reading and the check for understanding, then the optional activities. In science it is the lesson's numbered steps, one day at a time.
3. *Check the work and finish*: the answer key.

**Next step** and **Back** move through the lesson, and the book turns to the page of each step. You can also click any step in the list. A step with a time has a timer you can start. Under *Books for this lesson*, buttons switch the book between the teacher guide, the student pages, the reader and the answer key without leaving the lesson. **Finish the lesson** ticks it in the plan and offers the next lesson of the same day.

The steps are read from the teacher guides, so they are the publisher's own. Three things to know. The guide is written for a teacher with a class: read "students" as your child and adapt group work. Some mathematics guides are printed in fonts whose letters cannot be read as text; their steps are still found, but may be named only "Activity 2", and a few have no time. And tests, review days and the end-of-year novel study have no parts to read, so they get three general steps.

**The week.** *What this week covers* names the unit and lessons of each subject. Under it, each day lists its lessons, with their names where the guide gives them. Besides *Start lesson*, every lesson has links:

- **Lesson plan**: the teacher guide, at that lesson.
- **Student pages** or **Activity pages**: what the student works in.
- **Reading** or **Reader**: the chapter read that day.
- **Answer key**, **The test**, **Pacing guide**: where the unit has them.

A link that says "p. 12" opens the book inside the app at the page the app found for it. The page comes from reading the book's text, not from a table the publisher supplies, so it can be a page or two off, and sometimes it is not found; then the link opens the book at its first page. The bar above the book says which book and page it is, and **Back to the plan** returns to the week. The viewer's own buttons print or save the file.

Tick a lesson when it is done. The count at the top right is days of lessons done out of the year, and *Go to week N, where you are* jumps to the first week with something unticked.

**The year.** Every unit of every subject: what it teaches, the weeks it falls in, the days done, and its files. Ticking **Skip** on a unit takes it out of the plan; that subject's remaining units then spread evenly over the 36 weeks. One science unit covers human growth and reproduction and is marked, so you can read it first and decide.

**Search the school books.** The box at the top searches the text of every page of every book, including ones you added. A result opens the book at that page. This search is separate from the search box in the top bar and from Ask, which work on the encyclopedia.

**Books and supplies.** The lessons are free, but a few are built on things that are not:

- *They Call Me Güero* by David Bowles, the book the first language arts unit reads.
- *Adventures of Don Quixote*, the Dover edition adapted by Argentina Palacios.
- *The Science of Breakable Things* by Tae Keller, for the novel study that ends the year.
- The *Poet's Journal* for the poetry unit, a workbook sold by Amplify to schools. If you cannot get it, skip that unit on the year page.
- Materials for the science investigations. Each science teacher guide lists what its unit needs.

Printing is optional: everything can be read on screen, but the activity pages are meant to be written on. The app buys and orders nothing; the boxes there are only your own checklist.

**Books I have added.** PDFs you own, such as a course bought as a download, can be copied into the library with *Add PDF books*. They are searched with the rest and move with the library. Books bought from stores that lock them to a reader app cannot be added, because they are not plain PDF files.

**Where it is kept, and how big it is.** `<library>\school\g5\` holds the PDFs, `school\index\` the text of their pages, and `school\progress-g5.json` your ticks. All of it moves with Wikipedia whenever the library is moved, counts toward the size of a dedicated partition, and is removed by the uninstaller if you ask it to remove your data. The PDFs are stored as the publisher made them. They are not compressed further: a PDF is already compressed inside, so packing it again saves very little.

**Licences.** The Core Knowledge materials are under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 licence; the mathematics is based on IM K-5 Math by Illustrative Mathematics, under Creative Commons Attribution 4.0. They are free to use and copy for teaching and may not be sold. Wikivault is not affiliated with or endorsed by either.
