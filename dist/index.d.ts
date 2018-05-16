export declare class PDFFormsFiller {
    private formTemplatePath;
    private outputFilePath;
    private writer;
    private data;
    constructor(formTemplatePath: string, outputFilePath: string);
    fillForm(data: any): void;
    /**
     * initWriter method. writer setup
     */
    private initWriter();
    /**
     * closeWriter method. writer clean-up
     */
    private closeWriter();
    /**
     * toText function. should get this into hummus proper sometimes
     */
    private toText(item);
    /**
     * a wonderfully reusable method to recreate a dict without all the keys that we want to change
     * note that it starts writing a dict, but doesn't finish it. your job
     */
    private startModifiedDictionary(handles, originalDict, excludedKeys);
    private defaultTerminalFieldWrite(handles, fieldDictionary);
    /**
     * Update radio button value. look for the field matching the value, which should be an index.
     * Set its ON appearance as the value, and set all radio buttons appearance to off,
     * but the selected one which should be on
     */
    private updateOptionButtonValue(handles, fieldDictionary, value);
    private writeAppearanceXObjectForText(handles, formId, fieldsDictionary, text, inheritedProperties);
    private writeFieldWithAppearanceForText(handles, targetFieldDict, sourceFieldDictionary, appearanceInField, textToWrite, inheritedProperties);
    private updateTextValue(handles, fieldDictionary, value, isRich, inheritedProperties);
    private updateChoiceValue(handles, fieldDictionary, value, inheritedProperties);
    /**
    * Update a field. splits to per type functions
    */
    private updateFieldWithValue(handles, fieldDictionary, value, inheritedProperties);
    private writeFieldAndKids(handles, fieldDictionary, inheritedProperties, baseFieldName);
    /**
    * writes a single field. will fill with value if found in data.
    * assuming that's in indirect object and having to write the dict,finish the dict, indirect object and write the kids
    */
    private writeFilledField(handles, fieldDictionary, inheritedProperties, baseFieldName);
    /**
    * Write kids array converting each direct kids to an indirect one
    */
    private writeKidsAndEndObject(handles, parentDict, kidsArray);
    /**
    * write fields/kids array of dictionary. make sure all become indirect, for the sake of simplicity,
    * which is why it gets to take care of finishing the writing of the said dict
    */
    private writeFilledFields(handles, parentDict, fields, inheritedProperties, baseFieldName);
    /**
    * Write a filled form dictionary, and its subordinate fields.
    * assumes in an indirect object, so will finish it
    */
    private writeFilledForm(handles, acroformDict);
}
