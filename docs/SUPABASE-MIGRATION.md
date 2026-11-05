# GlobalEduAI → Supabase

მდგომარეობა: მიგრაცია დასრულებულია 2026-11-05. Production და პირადი ლოკალური კონფიგურაცია იყენებს Supabase PostgreSQL-ს, `globaledu_private` სქემას. 13-ვე ცხრილი რეალურად დაკოპირდა და დამოუკიდებლად გადამოწმდა. არსებული ოთხი მომხმარებელი, პაროლის ჰეშები, ორი სესია და ადმინისტრატორის ID-ები შენარჩუნებულია. ძველი Neon ბაზა დარჩა სარეზერვო ასლად; მოქმედი აპი მას აღარ ირჩევს.

## 1. შექმენი პროექტი

1. გახსენი https://supabase.com/dashboard და აირჩიე **New project**.
2. მიუთითე ორგანიზაცია, სახელი `GlobalEduAI` და ევროპული რეგიონი, მაგალითად Frankfurt. გეგმა აირჩიე თავად; ფასიანი გეგმა კოდის მომზადებისთვის არ არის საჭირო.
3. შექმენი ძლიერი Database password და შეინახე პაროლების მენეჯერში. ჩატში არ გამოაგზავნო.
4. დაელოდე პროექტის მომზადებას და გახსენი **Connect**.
5. **Transaction pooler**-ის URI შეინახე `Server/.env`-ის `SUPABASE_DATABASE_URL`-ში. ეს არის აპის serverless runtime კავშირი, ჩვეულებრივ პორტი 6543.
6. **Session pooler**-ის URI შეინახე `SUPABASE_DIRECT_DATABASE_URL`-ში, პორტი 5432. ის მიგრაციისთვის გამოიყენება და IPv4 ქსელშიც მუშაობს. IPv6 ხელმისაწვდომობისას შეიძლება პირდაპირი კავშირიც.

URI-ში `[YOUR-PASSWORD]` შეცვალე Database password-ით; სპეციალური სიმბოლოები URL-encoded უნდა იყოს. hostname და username ყოველთვის Connect-იდან აიღე — მათ რეგიონიდან ნუ გამოითვლი. ეს PostgreSQL კავშირია და არა Project URL / publishable key / anon key.

ველი `SUPABASE_DB_CA_CERT` საჭიროების შემთხვევაში შეიცავს Database settings-დან ჩამოტვირთულ Supabase Root CA-ს PEM ტექსტს. TLS სერტიფიკატის შემოწმება ყოველთვის ჩართული რჩება. შეცდომისას `rejectUnauthorized=false` არ გამოიყენო.

სამივე ცარიელი ველი დაემატა პირად `Server/.env`-ს, არსებული მნიშვნელობების შეცვლის გარეშე. მხოლოდ ამ ველების შევსება live ბაზას არ გადართავს. ჯერ არ შეცვალო ძველი `DATABASE_URL`, `POSTGRES_URL`, `AUTH_DB_DRIVER` ან `DATABASE_PROVIDER`.

## 2. ზუსტად რა გადადის

სრული მონაცემები, არსებული ID-ებით:

| მონაცემები | ცხრილები |
| --- | --- |
| ანგარიშები, bcrypt პაროლის ჰეშები, აკადემიური/მრჩევლის პროფილები, ფავორიტები | `globaledu_users` |
| სესიების SHA-256 ჰეშები და არსებული ვადები | `globaledu_sessions` |
| ანგარიშის სქემის ვერსია | `globaledu_schema_migrations` |
| ადმინის გამოქვეყნებული კონტენტი და ცვლილებების აუდიტი | `globaledu_content`, `globaledu_content_audit` |
| პაკეტები, გამოწერები, გადახდები, მოხმარება, აქტივობა, მოვლენები, კონსულტაციები, Refund | რვა `billing_*` ცხრილი |

სულ 13 ცხრილია. პაროლის ჰეში, მომხმარებლის ID, სესიის ჰეში და ვადა უცვლელად გადადის; საიტის არსებული cookie-ავტორიზაცია გრძელდება. ადმინისტრატორის არსებული `ADMIN_ACCOUNT_IDS` იმავე ID-ებზე იმუშავებს.

ეს არის **არსებული ავტორიზაციის მონაცემების Supabase PostgreSQL-ში გადატანა**. Supabase Auth-ის `auth.users`-ში იმპორტი და მისი JWT/refresh-token სესიების გამოყენება ამ ცვლილებაში არ შედის. Supabase Auth-ზე ცალკე გადასვლა სესიის მექანიზმის შეცვლასაც მოითხოვს. გადასატანი ანგარიშები Supabase Table Editor-ში `globaledu_private` სქემაში გამოჩნდება და არა Auth → Users-ში.

გამოქვეყნებული უნივერსიტეტების/პროგრამების საჯარო საწყისი JSON კატალოგი და ვებსაიტის HTML/CSS/JS აქტივები რჩება Git/Vercel-ში; ბაზის კონტენტის ცვლილებების ფენა Supabase-ში გადადის. ეს საჯარო ფაილები პირად ანგარიშებს ან პაროლებს არ შეიცავს.

PDF ფაილები ახლა მუდმივად სერვერზე არ ინახება — მხოლოდ მოთხოვნის მეხსიერებაში მუშავდება; ამიტომ გადასატანი cloud ფაილები არ არსებობს. ბრაუზერში შენახული პირადი planner/ჩანაწერები ამ სერვერულ მიგრაციაში არ მონაწილეობს. Supabase Storage-ში მუდმივი დოკუმენტების დამატებასა და planner-ის cloud სინქრონიზაციას ცალკე ფუნქცია სჭირდება.

`OPENAI_API_KEY`, BOG-ის საიდუმლოებები, email-ის პაროლი და `CRON_SECRET` რჩება Vercel-ის server-only გარემოში. მათ საჯარო ცხრილში გადატანა უსაფრთხო კონფიგურაციის შემცვლელი არ არის. მხოლოდ ახალი DB URI-ები უნდა დაემატოს Vercel-ის Secrets-ს; ისინი Git-ში ან ბრაუზერში არ იგზავნება.

## 3. უსაფრთხოების არქიტექტურა

- სამივე store ერთ provider-ს იყენებს `Server/database-config.js`-იდან. `DATABASE_PROVIDER=supabase` აირჩევს მხოლოდ `SUPABASE_DATABASE_URL`-ს; მისი არყოფნისას ძველ Neon/Vercel `POSTGRES_URL`-ზე ავტომატური fallback არ ხდება.
- აპის ყველა ცხრილი არის `globaledu_private` სქემაში. ის Data API-ის exposed schemas-ში არ უნდა დაემატოს.
- მიგრაცია აუქმებს `PUBLIC`, `anon`, `authenticated`, `service_role` როლების schema/table/sequence წვდომებს და ააქტიურებს RLS-ს. საჯარო RLS policies არ იქმნება. Backend იყენებს სერვერულ PostgreSQL როლს; მომხმარებლის წვდომა კვლავ მოწმდება Express-ის ავტორიზაციით.
- მიგრაციის ბოლოს მოწმდება RLS და თითოეული API როლის რეალური წვდომა. ამ შემოწმების ჩავარდნა copy-ს rollback-ს იწვევს.
- სტანდარტული HTTP მოთხოვნები მიგრაციას ან მონაცემების კოპირებას არ იწყებს. ინსტრუმენტი პაროლებიან URI-ებს, პაროლის ჰეშებს ან account rows-ს არ ბეჭდავს და dump ფაილებს არ ქმნის.

## 4. მიგრაციის ბრძანებები

```powershell
npm run supabase:check
npm run supabase:copy
npm run supabase:verify
node scripts/migrate-to-supabase.js --rehearse
```

`check` ნაგულისხმევი რეჟიმია: კითხულობს მხოლოდ სქემას და ცხრილების რაოდენობებს; სამიზნეზე DDL/ჩაწერა არ სრულდება.

`copy` მუშაობს მხოლოდ `DATA_MIGRATION_READ_ONLY=true` პირობებში. წყარო იკითხება თანმიმდევრული read-only snapshot-ით; სამიზნეზე სქემა, მონაცემები და grants ერთ ტრანზაქციაში თავსდება. მონაცემები მცირე პარტიებით გადადის, JSON და timestamp სიზუსტის შენარჩუნებით. თითოეული ცხრილის რაოდენობა და შიგთავსის SHA-256 შედარება მოწმდება. განსხვავება სრულ rollback-ს იწვევს. შევსებული სამიზნე არ იწმინდება და ავტომატურად არ ერთიანდება; მხოლოდ ინსტრუმენტის მიერ შექმნილი სქემის version marker შეიძლება ჩანაცვლდეს.

`verify` ხელახლა ადარებს წყაროსა და სამიზნის შიგთავსს read-only რეჟიმში. ის უნდა შესრულდეს copy-ის შემდეგ და live გადართვამდე.

`rehearse` ასრულებს სრულ copy-ს, checksum/ACL/RLS შემოწმებას და ბოლოს სამიზნის ტრანზაქციას ROLLBACK-ით აუქმებს. წყარო read-only snapshot-ია, მოქმედი საიტი არ ჩერდება. ეს რეჟიმი რეალურ Supabase-ზე სქემის/მონაცემების საცდელად გამოიყენება რეალურ copy-მდე. იგი runtime provider-ს არ ცვლის და maintenance flag-ს არ მოითხოვს. Vercel build-შიც მხარდაჭერილია `SUPABASE_MIGRATION_ACTION=rehearse`.

წყარო: `SUPABASE_SOURCE_DATABASE_URL`, ან მის არყოფნისას ძველი `DATABASE_URL` / `POSTGRES_URL`. სამიზნე: `SUPABASE_DIRECT_DATABASE_URL`. Source/target ერთი Supabase პროექტი არ უნდა იყოს; მიგრაცია არ შეეხება Supabase-ის managed `auth` ან `storage` სქემებს.

## 5. Live გადატანის თანმიმდევრობა

ქვემოთ აღწერილი თანმიმდევრობა ამ მიგრაციაზე უკვე შესრულდა; ის რჩება ოპერაციულ ინსტრუქციად მომავალი გადატანისთვის.

1. შეამოწმე source და destination პროექტების იდენტურობა და ანგარიშების მოსალოდნელი რაოდენობა. პირველი რეალური ასლი გამოიყენე საცდელად; გადაამოწმე student/advisor login, ძველი cookie, ადმინისტრატორი, CMS და billing. ძველი ბაზა შეინარჩუნე.
2. Vercel-ში მხოლოდ server Secrets-ის სახით დაამატე Supabase-ის DB URI-ები და საჭირო CA. ძველი კავშირის საიდუმლოებები ლოკალურად არ ჩამოტვირთო. სამიზნე მისამართების დასამატებლად `Server/.env`-ის პირადი მნიშვნელობები შეიძლება გამოიყენო; ისინი არ უნდა დაიბეჭდოს.
3. მოკლე maintenance ფანჯრისთვის ჩართე `DATA_MIGRATION_READ_ONLY=true` და გამოაქვეყნე არსებულ provider-ზე. დაელოდე მიმდინარე ჩაწერების დასრულებას. საჯარო კატალოგი მუშაობს; ანგარიშის ფუნქციები, login/register, billing, callbacks და cron დროებით 503-ს მიიღებს. ძველი deployment-ების/სხვა worker-ების ჩაწერაც უნდა შეჩერდეს; მხოლოდ env flag-ის არსებობა ყველა writer-ის გაჩერებას ვერ ადასტურებს.
4. Vercel build-ში `SUPABASE_MIGRATION_ACTION=check` ასრულებს preflight-ს უკვე არსებულ source credentials-თან. შემდეგ `copy`, ბოლოს ცალკე `verify`. ჩვეულებრივ build-ში ცარიელი/არარსებული flag მხოლოდ `skipped: true`-ს აბრუნებს. რეჟიმი თვითონ runtime provider-ს არ ცვლის.
5. წარმატებული რეალური შემოწმების შემდეგ წაშალე `SUPABASE_MIGRATION_ACTION`; დააყენე `DATABASE_PROVIDER=supabase`, `AUTH_DB_DRIVER=postgres`, `SUPABASE_DATABASE_URL` და `SUPABASE_DIRECT_DATABASE_URL` სწორ მნიშვნელობებზე. მოაშორე maintenance flag და გამოაქვეყნე.
6. შეამოწმე რეალური login/profile, ადმინისტრატორის უფლებები, content/billing და უცნობი მომხმარებლის წვდომის უარყოფა. გადაამოწმე Supabase Data API-ის წვდომები და რომ `globaledu_private` exposed schemas-ში არ არის.
7. ძველი ბაზა მაშინვე არ წაშალო. სანამ ახალში ჩაწერა განახლდება, ძველ provider-ზე დაბრუნება შესაძლებელია კონფიგურაციით; ახალი ჩაწერების შემდეგ rollback უკვე მონაცემების შეჯერებას მოითხოვს.

## 6. ამ ეტაპზე შესრულებული შემოწმებები

352 ავტომატური ტესტი წარმატებით დასრულდა, მათ შორის private-schema store ინტეგრაცია PostgreSQL ემულატორზე, პაროლის/სესიის იდენტურობა, provider-ის აშკარა არჩევა, TLS, მიგრაციის read-only preflight, შევსებული სამიზნის დაცვა, ბოლო ცხრილზე შეცდომისას rollback, უცხო აპის ცხრილების დაცვა და შიგთავსის განსხვავების აღმოჩენა. შემოწმებულია maintenance რეჟიმში პირადი GET-ების, ავტორიზაციისა და ფინანსური ჩაწერის შეჩერება საჯარო კატალოგის შენარჩუნებით. Build/კატალოგის/სინტაქსის შემოწმება წარმატებულია.

ტესტის transport fixture მხოლოდ ლოგიკის შემოწმებაა. დამატებით შესრულდა რეალური ქსელური კავშირი, native Supabase grants/RLS შემოწმება, rollback-only rehearsal, რეალური copy და ცალკე verify. სტუდენტის/მრჩევლის დროებითი ანგარიშებით პაროლით შესვლა, HttpOnly სესიები, პროფილი, billing, კრედიტის დაკავება/დაბრუნება და დამალული CMS ჩანაწერის ჩაწერა/წაკითხვა რეალურ Supabase-ზე შემოწმდა. ყველა სატესტო ჩანაწერი წაიშალა.

ოფიციალური წყაროები: [Postgres კავშირები](https://supabase.com/docs/guides/database/connecting-to-postgres), [Postgres → Supabase](https://supabase.com/kb/guides/migrate-from-postgres), [Data API-ის დაცვა](https://supabase.com/docs/guides/api/securing-your-api), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 7. დასრულების მტკიცებულება — 2026-11-05

- Rehearsal: `globaleduai-oq2ni9cp5-georges-projects-97451956.vercel.app`, mode=rehearse, verified=true, copied=false; სამიზნე ROLLBACK-ის შემდეგ ცარიელი დარჩა.
- Copy: `globaleduai-20kq47alq-georges-projects-97451956.vercel.app`, 2026-11-05T19:17:55Z, mode=copy, verified=true, copied=true.
- დამოუკიდებელი შედარება საცდელი ჩანაწერების გასუფთავების შემდეგ: `globaleduai-ilcl7amcz-georges-projects-97451956.vercel.app`, 2026-11-05T19:20:52Z, mode=verify, verified=true; 13-ვე ცხრილი თანხვედრაშია.
- Live cutover: `globaleduai-gbu3os7kq-georges-projects-97451956.vercel.app`, Ready; alias https://globaleduai.vercel.app. `DATABASE_PROVIDER=supabase`; ერთჯერადი migration და maintenance flags წაშლილია.
- საჯარო საიტმა წარმატებით დააბრუნა მხოლოდ Supabase-ში არსებული დროებითი სატესტო ანგარიშის `/api/auth/me` და `/api/billing/me` (200), ხოლო ადმინის მაჩვენებლები უარყო (403). ეს ადასტურებს live მარშრუტს Supabase-მდე. სატესტო ანგარიში და ყველა დაკავშირებული ჩანაწერი წაიშალა; დარჩა ოთხი რეალური მომხმარებელი.
- საჯარო auth/status: ready=true; CMS: available=true; კატალოგი: 4,378 პროგრამა; ოთხივე პაკეტი ხელმისაწვდომია; ბანკის გადახდები კვლავ გამორთულია.
- Root CA ჩამოტვირთულია Supabase dashboard-ის ოფიციალური source-ის მიერ მითითებული HTTPS მისამართიდან. Fingerprint SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. TLS სერტიფიკატისა და hostname-ის შემოწმება არ გამორთულა.
- Supabase-ის ორივე SQL URI და CA გადატანილია Vercel Production Secrets-ში მომხმარებლის აშკარა თანხმობით. ძველი source credentials ლოკალურად არ ჩამოტვირთულა. პირადი .env არ დაკომიტებულა.

კოპირების snapshot-ის რაოდენობები:

| ცხრილი | ჩანაწერი |
| --- | ---: |
| globaledu_schema_migrations | 1 |
| globaledu_users | 4 |
| globaledu_sessions | 2 |
| globaledu_content | 0 |
| globaledu_content_audit | 0 |
| billing_plans | 4 |
| billing_members | 2 |
| billing_payments | 0 |
| billing_usage | 4 |
| billing_activity | 4 |
| billing_events | 2 |
| billing_consultations | 0 |
| billing_refunds | 0 |

ეს არის cutover-მდე შედარებული snapshot. საიტის გამოყენების განახლების შემდეგ აქტივობისა და სესიების რაოდენობები ბუნებრივად შეიძლება შეიცვალოს.
