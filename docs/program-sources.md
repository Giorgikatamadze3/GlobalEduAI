# კონკრეტული პროგრამების წყაროები

განახლება: **2026-10-28**. ფაილი: `Server/data/programs.json`. ქვემოთ მოყვანილი 20 უნივერსიტეტის გვერდით გადამოწმებული საწყისი ჩანაწერის ფაქტები შემოწმებულია **2026-10-27**-ს; ახალმა იმპორტმა ძველ ფინანსურ/სააპლიკაციო ფაქტებს ხელახალი შემოწმების თარიღი ავტომატურად არ მიანიჭა.

კატალოგი აერთიანებს ხელით გადამოწმებულ საწყის პროგრამებსა და ოფიციალური DAAD დირექტორიიდან იმპორტირებულ რეალურ პროგრამებს. DAAD-ის პროგრამები გერმანიის საერთაშორისო შეთავაზებების ნაწილს მოიცავს. სრული მიმდინარე რაოდენობები, დაუკავშირებელი ჩანაწერები და იმპორტის ანგარიში აღწერილია [დაფარვის დოკუმენტში](PROGRAM-COVERAGE.md). უნივერსიტეტის დირექტორიაში არსებობა კონკრეტულ პროგრამას, მიღების პირობებს ან აკრედიტაციას არ ადასტურებს.

## ოფიციალური დირექტორიიდან იმპორტი

წყაროების რეესტრია [`program-source-registry.json`](../Server/data/program-source-registry.json); ადაპტერია [`official-catalogs.js`](../scripts/providers/official-catalogs.js). [DAAD International Programmes](https://www2.daad.de/deutschland/studienangebote/international-programmes/) აქვეყნებს პროგრამის სათაურს, დაწესებულებას, საფეხურს, ენებსა და დარგის დასახელებას. ინდივიდუალურ გვერდზე დაწესებულების ზუსტი საკონტაქტო ბმული გამოიყენება უნივერსიტეტის დომენის დასადასტურებლად.

იმპორტი ინახავს წყაროს ID-ს, პროგრამის საწყის ID-ს, ოფიციალურ გვერდს, ჩამონათვალის წყაროსა და შემოწმების თარიღს. კონკრეტული საუნივერსიტეტო პროგრამის გარე ბმული ინახება მხოლოდ მაშინ, როცა სწორედ მისი DAAD გვერდია წაკითხული; ერთი პროგრამის ბმული უნივერსიტეტის სხვა პროგრამებს არ გადაეცემა.

`courseType` 1/2/3 შესაბამისად აღწერს ბაკალავრიატს, მაგისტრატურასა და PhD/დოქტორანტურას. კვლევითი სკოლა მხოლოდ მსგავსი სახელით PhD-დ არ ჩაითვლება. დარგი გამოითვლება მხოლოდ გამოქვეყნებული ზუსტი დისციპლინის კონტროლირებადი შესატყვისით; სათაურიდან ან საერთო ფილტრის სტატისტიკიდან არ იგონება. უცნობი ან რამდენიმე დარგის გაერთიანებული ჩანაწერი უცნობად რჩება.

ჩამოთვლილი რამდენიმე ენა ინახება `languages`/საწყის ენობრივ მონაცემებში, ხოლო `language` შეიძლება დარჩეს `null`: ინგლისური და გერმანული ერთად ინგლისურენოვან დამოუკიდებელ გზას არ ადასტურებს. ჩამონათვალში არასაკმარისი ინფორმაცია არ ივსება რეჟიმით, ფასით, GPA-ით, მიღების ვადით ან სტიპენდიით.

DAAD-ის წყარო უნივერსიტეტის გვერდით ცალ-ცალკე გადამოწმების იდენტური არ არის. [ოფიციალური imprint](https://www.daad.de/en/imprint/) აცხადებს საავტორო უფლებებს; ღია მონაცემთა ლიცენზია დადასტურებული არ არის. Hipo დირექტორიის MIT ლიცენზია DAAD-ის პროგრამებზე არ ვრცელდება. იმპორტი არ მოიცავს ფოტოებსა და სრულ აღწერით ტექსტებს; დამატებითი გამოყენების პირობები რეესტრშია მითითებული.

## მონაცემების მნიშვნელობა

- `verificationStatus: official-source` ნიშნავს, რომ ჩანაწერს აქვს უნივერსიტეტის ოფიციალური პროგრამის/მიღების გვერდი. ეს არ ნიშნავს ყველა ველის სრულ გადამოწმებას ან სტუდენტის მიღებას.
- `verificationStatus: official-directory` აღნიშნავს რეესტრში მითითებული ოფიციალური პროგრამების დირექტორიის წყაროს. იგი არ ადასტურებს გამოუქვეყნებელ ფასს, მიღების ღია ციკლს, ყველა სააპლიკაციო პირობას ან სრულ ეროვნულ დაფარვას.
- `null` ნიშნავს უცნობ ან ინდივიდუალურად დასადგენ ინფორმაციას. ის არ იცვლება ნულით, უფასო სწავლით ან დაკმაყოფილებული მოთხოვნით.
- საფასურს ახლავს ვალუტა, პერიოდი და განმცხადებლის კატეგორია. `non-eu` ფასი არ არის EU/EEA სტუდენტის ფასი. მოქალაქეობის, ბინადრობისა და დიპლომის გამონაკლისები ცალკე მოწმდება.
- `tuition.amount: 0` მხოლოდ სწავლის საფასურის არქონაა. სემესტრული შენატანი და ცხოვრების ხარჯები შეიძლება რჩებოდეს. სრულ დაფინანსებად არ ითვლება.
- არცერთ პროგრამას არ ენიჭება გარანტირებული სწავლისა და ცხოვრების ერთობლივი დაფინანსება. ცალკე არსებული 12 სქემა მოწმდება ზუსტი მონაწილეობისა და პირადი პირობების მიხედვით; მხოლოდ უნივერსიტეტის ქვეყანა DAAD, DSU ან სხვა სტიპენდიას არ ანიჭებს. იხილეთ [დაფინანსების წყაროები](FUNDING-SOURCES.md).
- GPA-ის ადგილობრივი სკალები არ გადაითვლება ავტომატურად საერთო პროცენტად. TalTech-ის 60% უშუალოდ ოფიციალურ მოთხოვნაშია გამოქვეყნებული; Oxford-ის first-class, UBC-ის B+ და CMU-ის GPA 3.0 დარჩა განმარტებაში.
- ენის საერთო ქულასთან ერთად, სადაც დადასტურებულია, სტრუქტურულად ინახება კომპონენტური მინიმუმებიც. გამონაკლისები, მოქმედების ვადა და დამატებითი პირობები კვლავ ოფიციალურ გვერდზე უნდა შემოწმდეს.
- განმეორებად დღე/თვეს მიმდინარე წელი არ დაემატა. ერთი თარიღი მიეთითა მხოლოდ კონკრეტული, ოფიციალურად გამოცხადებული მიღების ციკლისთვის. განაცხადის ვადა არ არის რეგისტრაციის ან დაფინანსების ვადა.
- იმპორტირებული `institutionId` უკავშირდება ქვეყნისა და ოფიციალური დომენის ერთმნიშვნელოვან დამთხვევას. საწყისი ხელით გადამოწმებული ჩანაწერები შეიძლება ცალკე სანდო კავშირის წესით მუშავდებოდეს; ახალი იმპორტის დაუკავშირებელი ან ორაზროვანი უნივერსიტეტები ანგარიშში რჩება და მათ პროგრამებს სხვა დაწესებულება არ მიეწერება.

## საწყისი 20 პროგრამის საუნივერსიტეტო წყაროები

| პროგრამა | ძირითადი წყარო და გამოყენებული მონაცემები |
|---|---|
| Saarland — Computer Science MSc | [პროგრამა](https://www.uni-saarland.de/en/study/programmes/master/informatics.html), [საფასურის წესი](https://www.uni-saarland.de/en/study/organisation/fees.html): ინგლისური/C1, 24 თვე, სწავლის საფასური 0; სემესტრული შენატანი დამატებითია. |
| TUM — Informatics MSc | [პროგრამა](https://www.tum.de/en/studies/degree-programs/detail/informatics-master-of-science-msc), [non-EU ტარიფი](https://www.tum.de/en/studies/fees/tuition): 24 თვე, ინგლისური. სემესტრული და მომავალი ტარიფების გამო წლიური ფასი არ გამოიგონა. |
| TalTech — Cybersecurity MSc | [პროგრამა](https://taltech.ee/en/masters-programmes/cybersecurity), [degree admissions](https://taltech.ee/en/apply): 7,000 EUR/წელი non-EU, 60% CGPA, დამატებითი შეფასებები; IELTS 6.0 და კომპონენტები 5.5. |
| Tartu — Computer Science MSc | [პროგრამა](https://ut.ee/en/curriculum/computer-science), [ენა](https://ut.ee/en/english-language-requirements): 7,200 EUR/წელი non-EU, 24 თვე, ინგლისური. |
| Aalto — Computer Science MSc | [პროგრამა](https://www.aalto.fi/en/study-options/computer-science-master-of-science-technology), [ენა](https://www.aalto.fi/en/admission-services/language-requirements-in-masters-admissions): 17,000 EUR/წელი non-EU; 2027 ციკლის განაცხადი. |
| Helsinki — Data Science MSc | [პროგრამა](https://www.helsinki.fi/en/degree-programmes/data-science-masters-programme), [ენა](https://www.helsinki.fi/en/admissions-and-education/apply-bachelors-and-masters-programmes/apply-international-masters-programmes/proving-your-english-language-skills): 15,000 EUR/წელი non-EU; არჩეულია ინგლისურენოვანი სწავლა. |
| Politecnico di Milano — Computer Science and Engineering MSc | [პროგრამა](https://www.polimi.it/en/education/laurea-magistrale-programmes/programme-detail/computer-science-and-engineering-ingegneria-informatica), [საფასური](https://www.polimi.it/en/students/tuition-fees-scholarships-and-financial-aid/tuition-fees/): 24 თვე, ინგლისური; ინდივიდუალური საფასური `null`. |
| TU Delft — Computer Science MSc | [პროგრამა](https://www.tudelft.nl/en/education/programmes/masters/cs/msc-computer-science): 24 თვე, სრული დატვირთვა, ინგლისური; საფასური არ არის დადასტურებული. |
| Utrecht — Artificial Intelligence MSc | [პროგრამა](https://www.uu.nl/en/masters/artificial-intelligence): 24 თვე; non-EU institutional fee 25,306 EUR მითითებულია **2026/27** წლისთვის. |
| Oxford — Advanced Computer Science MSc | [პროგრამა](https://www.ox.ac.uk/admissions/graduate/courses/msc-advanced-computer-science): 12 თვე, 2027/28 ციკლი, IELTS 7.5/კომპონენტები 7.0. Home ფასი overseas ფასად არ გამოიყენება. |
| UBC Vancouver — Master of Data Science | [პროგრამა/საფასური](https://www.grad.ubc.ca/prospective-students/graduate-degree-programs/master-of-data-science), [მიღება](https://masterdatascience.ubc.ca/admissions): 10 თვე; საერთაშორისო პროგრამის ფასი CAD-ში; 2027 მიღება. |
| Carnegie Mellon — Computational Data Science | [პროგრამა](https://www.lti.cmu.edu/academics/masters-programs/mcds.html): სტანდარტული 16 თვე, ასევე 20-თვიანი ვარიანტი; GPA 3.0 პროცენტად არ გადაითვალა. |
| Warwick — Management MSc | [პროგრამა](https://warwick.ac.uk/study/postgraduate/courses/msc-management/): ერთწლიანი სრული დატვირთვა; 2:1 და IELTS Band B კომპონენტური წესი რჩება აღწერაში. |
| Sciences Po — Master in Public Policy | [პროგრამა](https://www.sciencespo.fr/ecole-affaires-publiques/en/academics/masters/master-public-policy/): ორწლიანი პროგრამის მხოლოდ ინგლისურენოვანი policy stream-ები; ფრანგულენოვან stream-ებზე ეს ენა არ ვრცელდება. |
| Aalto — Collaborative and Industrial Design MA | [პროგრამა](https://www.aalto.fi/en/study-options/collaborative-and-industrial-design-master-of-arts-art-and-design), [ენა](https://www.aalto.fi/en/admission-services/language-requirements-in-masters-admissions): 20,000 EUR/წელი non-EU, 24 თვე, 2027 მიღება. |
| Helsinki — Science BSc | [პროგრამა](https://www.helsinki.fi/en/degree-programmes/science-bachelors-programme), [მიღების ჯგუფები](https://www.helsinki.fi/en/admissions-and-education/apply-bachelors-and-masters-programmes/apply-bachelors-programmes): 36 თვე, 13,000 EUR/წელი; უცნობი ჯგუფის გამო ერთი ვადა არ მინიჭებულა. |
| Tartu — Science and Technology BSc | [პროგრამა](https://ut.ee/en/curriculum/science-and-technology), [ენა](https://ut.ee/en/english-language-requirements): 36 თვე, 6,000 EUR/წელი; განმეორებადი ვადის წელი არ არის ნავარაუდები. |
| Aalto — Economics BSc | [პროგრამა](https://www.aalto.fi/en/study-options/bachelors-programme-in-economics), [მიღება](https://www.aalto.fi/en/study-at-aalto/admission-to-the-bachelors-programme-in-economics-bachelor-and-master-of-science-in-economics-and): 3+2 გზის საბაკალავრო ფაზა; 12,000 EUR/წელი ამ ფაზისთვის. |
| Cambridge — Computer Science PhD | [სწავლა/ვადები](https://www.postgraduate.study.cam.ac.uk/courses/directory/cscspdpcs/study), [მოთხოვნები](https://www.postgraduate.study.cam.ac.uk/courses/directory/cscspdpcs/requirements): სრული დატვირთვით 3–4 წელი; არჩეულია Michaelmas 2027, დაფინანსებას უფრო ადრეული ვადა აქვს. |
| University of London — Computer Science BSc Online | [პროგრამა](https://www.london.ac.uk/study/courses/undergraduate/bsc-computer-science): ონლაინ გზა, 3–6 წელი, April 2027 მიღება; ქვეყნისა და სწავლების გზის ცვლადი ფასი არ გამარტივდა ერთ თანხამდე. |

## განახლება

ხელით აღწერილი ფინანსური და სააპლიკაციო ფაქტები კვლავ ინდივიდუალურად მოწმდება პირველწყაროებთან. ფასის, პროგრამის სახელის, ენის ან ვადის შეცვლისას განაახლეთ კონკრეტული წყაროს ბმული, `checkedAt`, `updatedAt` და შესაბამისი ციკლი. გაურკვეველი მნიშვნელობა უნდა დაბრუნდეს `null`-ზე. შევსებისას შემოწმდეს არა მხოლოდ სქემა, არამედ საფასურის მოქმედი წელი/აპლიკანტი, ენის ყველა კომპონენტი და მიღების სრული წინაპირობები.

DAAD იმპორტის მშრალი შემოწმება, შენახვა და ქეშიდან განმეორება აღწერილია [დაფარვისა და განახლების ინსტრუქციაში](PROGRAM-COVERAGE.md). სხვადასხვა source ID-ის მქონე ერთნაირი სათაურები შესაძლოა განსხვავებული ტრეკები ან მიღებები იყოს; ისინი მხოლოდ ტექსტური მსგავსებით არ უნდა გაერთიანდეს. ხელით დადასტურებული სპეციფიკური ფასი ან მიღების პირობა უფრო მწირი დირექტორიის ჩანაწერით არ უნდა გადაიწეროს.

წყაროების მოკლე ფაქტობრივი შეჯამება მონაცემთა ბაზაში არ ცვლის უნივერსიტეტების საკუთარ წესებს. რეალური განაცხადის წინ განმცხადებელი უნდა გადავიდეს პროგრამის ოფიციალურ გვერდზე.
