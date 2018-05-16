import PDFFormsFiller from "./index";
import * as path from 'path';

let formTemplateFilePath = path.join(__dirname, "..", "sample-forms", "FormTemplate.pdf");
let outputFilePath = path.join(__dirname, "..", "output", "FormFilled.pdf");

let data = {
    "Given Name Text Box": "Eric",
    "Family Name Text Box": "Jones",
    "House nr Text Box": "someplace",
    "Address 1 Text Box": "somewhere 1",
    "Address 2 Text Box": "somewhere 2",
    "Postcode Text Box": "123456",
    "Country Combo Box": "Spain",
    "Height Formatted Field": "198",
    "Driving License Check Box": true,
    "Favourite Colour List Box": "Brown",
    "Language 1 Check Box": true,
    "Language 2 Check Box": true,
    "Language 3 Check Box": false,
    "Language 4 Check Box": false,
    "Language 5 Check Box": true,
    "Gender List Box": "Man"
};

console.log('FormTemplateFile : ', formTemplateFilePath);
console.log('OutputFile : ', outputFilePath);

let pdfFormsFiller:PDFFormsFiller = new PDFFormsFiller(formTemplateFilePath, outputFilePath);
pdfFormsFiller.fillForm(data);

console.log('Done !');

// testing that writer is correctly reopened if needed
/* data["Given Name Text Box"] = "James";
pdfFormsFiller.fillForm(data); */