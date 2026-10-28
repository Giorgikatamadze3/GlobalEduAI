// Explicit visual review mode only: ?preview=1. No account records are written to the database.
const DESIGN_PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
const PREVIEW_USER = { _id:'design-preview', name:'ანა მაისურაძე', email:'anna@example.com', phone:'+995555123456', favorites:[], role:'student', studentProfile:{educationLevel:'high-school',citizenshipCode:'GE',graduationYear:2027}, advisorProfile:null };
const PREVIEW_AGENCIES = [
    {id:1,name:'LEAF Education',desc:'საზღვარგარეთ სწავლის დაგეგმვა, პროგრამის შერჩევა და სააპლიკაციო პროცესში მხარდაჭერა.'},
    {id:2,name:'Prime Study',desc:'აღმოაჩინე სწავლის შესაძლებლობები ევროპაში და მოემზადე ახალი აკადემიური გამოცდილებისთვის.'},
    {id:3,name:'EducationUSA',desc:'შეისწავლე აშშ-ში სწავლის გზები და დაგეგმე შენი შემდეგი ნაბიჯი.'},
    {id:4,name:'Global Study',desc:'პროგრამების მოძიება, დოკუმენტების მოწესრიგება და განაცხადის დაგეგმვა.'},
    {id:5,name:'EuroEdu Consultants',desc:'ევროპული განათლება, საერთაშორისო შესაძლებლობები და ინდივიდუალური მხარდაჭერა.'},
    {id:6,name:'Future Leaders Academy',desc:'მოამზადე სამოტივაციო წერილი და შეხვდი გასაუბრებას თავდაჯერებულად.'}
];
