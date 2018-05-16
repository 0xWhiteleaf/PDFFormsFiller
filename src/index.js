var hummus = require('hummus');
var fs = require('fs');
var _ = require('lodash');
var PDFFormsFiller = (function () {
    function PDFFormsFiller(formTemplatePath, outputFilePath) {
        if (!fs.existsSync(formTemplatePath))
            throw new Error("Template not found !");
        this.formTemplatePath = formTemplatePath;
        this.outputFilePath = outputFilePath;
    }
    PDFFormsFiller.prototype.fillForm = function (data) {
        if (this.writer == null)
            this.initWriter();
        // setup parser
        var reader = this.writer.getModifiedFileParser();
        // start out by finding the acrobat form
        var catalogDict = reader.queryDictionaryObject(reader.getTrailer(), 'Root').toPDFDictionary();
        var acroformInCatalog = catalogDict.exists('AcroForm') ? catalogDict.queryObject('AcroForm') : null;
        if (!acroformInCatalog) {
            throw new Error('Form not found !');
        }
        // setup copying context, and keep reference to objects context as well
        var copyingContext = this.writer.createPDFCopyingContextForModifiedFile();
        var objectsContext = this.writer.getObjectsContext();
        // parse the acroform dict
        var acroformDict = catalogDict.exists('AcroForm') ? reader.queryDictionaryObject(catalogDict, 'AcroForm') : null;
        // lets put all the basics in a nice "handles" package, so we don't have to pass each of them all the time
        var handles = {
            reader: reader,
            copyingContext: copyingContext,
            objectsContext: objectsContext,
            data: data,
            acroformDict: acroformDict
        };
        // recreate a copy of the existing form, which we will fill with data. 
        if (acroformInCatalog.getType() === hummus.ePDFObjectIndirectObjectReference) {
            // if the form is a referenced object, modify it
            var acroformObjectId = acroformInCatalog.toPDFIndirectObjectReference().getObjectID();
            objectsContext.startModifiedIndirectObject(acroformObjectId);
            this.writeFilledForm(handles, acroformDict);
        }
        else {
            // otherwise, recreate the form as an indirect child 
            // (this is going to be a general policy, we're making things indirect. it's simpler), and recreate the catalog
            var catalogObjectId = reader.getTrailer().queryObject('Root').toPDFIndirectObjectReference().getObjectID();
            var newAcroformObjectId = objectsContext.allocateNewObjectID();
            // recreate the catalog with form pointing to new reference
            objectsContext.startModifiedIndirectObject(catalogObjectId);
            var modifiedCatalogDictionary = this.startModifiedDictionary(handles, catalogDict, { 'AcroForm': -1 });
            modifiedCatalogDictionary.writeKey('AcroForm');
            modifiedCatalogDictionary.writeObjectReferenceValue(newAcroformObjectId);
            objectsContext
                .endDictionary(modifiedCatalogDictionary)
                .endIndirectObject();
            // now create the new form object
            objectsContext.startNewIndirectObject(newAcroformObjectId);
            this.writeFilledForm(handles, acroformDict);
        }
        this.closeWriter();
    };
    /**
     * initWriter method. writer setup
     */
    PDFFormsFiller.prototype.initWriter = function () {
        this.writer = hummus.createWriterToModify(this.formTemplatePath, { modifiedFilePath: this.outputFilePath });
    };
    /**
     * closeWriter method. writer clean-up
     */
    PDFFormsFiller.prototype.closeWriter = function () {
        this.writer.end();
        this.writer = null;
    };
    /**
     * toText function. should get this into hummus proper sometimes
     */
    PDFFormsFiller.prototype.toText = function (item) {
        if (item.getType() === hummus.ePDFObjectLiteralString) {
            return item.toPDFLiteralString().toText();
        }
        else if (item.getType() === hummus.ePDFObjectHexString) {
            return item.toPDFHexString().toText();
        }
        else {
            return item.value;
        }
    };
    /**
     * a wonderfully reusable method to recreate a dict without all the keys that we want to change
     * note that it starts writing a dict, but doesn't finish it. your job
     */
    PDFFormsFiller.prototype.startModifiedDictionary = function (handles, originalDict, excludedKeys) {
        var originalDictJs = originalDict.toJSObject();
        var newDict = handles.objectsContext.startDictionary();
        Object.getOwnPropertyNames(originalDictJs).forEach(function (element) {
            if (!excludedKeys[element]) {
                newDict.writeKey(element);
                handles.copyingContext.copyDirectObjectAsIs(originalDictJs[element]);
            }
        });
        return newDict;
    };
    PDFFormsFiller.prototype.defaultTerminalFieldWrite = function (handles, fieldDictionary) {
        // default write of ending field. no reason to recurse to kids
        handles.copyingContext
            .copyDirectObjectAsIs(fieldDictionary)
            .endIndirectObject();
    };
    /**
     * Update radio button value. look for the field matching the value, which should be an index.
     * Set its ON appearance as the value, and set all radio buttons appearance to off,
     * but the selected one which should be on
     */
    PDFFormsFiller.prototype.updateOptionButtonValue = function (handles, fieldDictionary, value) {
        var isWidget = fieldDictionary.exists('Subtype')
            && (fieldDictionary.queryObject('Subtype').toString() === 'Widget');
        if (isWidget || !fieldDictionary.exists('Kids')) {
            // this radio button has just one option and its in the widget. also means no kids
            var modifiedDict = this.startModifiedDictionary(handles, fieldDictionary, { 'V': -1, 'AS': -1 });
            var appearanceName;
            if (value === null) {
                // false is easy, just write '/Off' as the value and as the appearance stream
                appearanceName = 'Off';
            }
            else {
                // grab the non off value. that should be the yes one
                var apDictionary = handles.reader.queryDictionaryObject(fieldDictionary, 'AP').toPDFDictionary();
                var nAppearances = handles.reader.queryDictionaryObject(apDictionary, 'N').toPDFDictionary().toJSObject();
                appearanceName = _.find(Object.keys(nAppearances), function (item) { return item !== 'Off'; });
            }
            modifiedDict
                .writeKey('V')
                .writeNameValue(appearanceName)
                .writeKey('AS')
                .writeNameValue(appearanceName);
            handles.objectsContext
                .endDictionary(modifiedDict)
                .endIndirectObject();
        }
        else {
            // Field. this would mean that there's a kid array, and there are offs and ons to set
            var modifiedDict = this.startModifiedDictionary(handles, fieldDictionary, { 'V': -1, 'Kids': -1 });
            var kidsArray = handles.reader.queryDictionaryObject(fieldDictionary, 'Kids').toPDFArray();
            var appearanceName;
            if (value === null) {
                // false is easy, just write '/Off' as the value and as the appearance stream
                appearanceName = 'Off';
            }
            else {
                // grab the non off value. that should be the yes one
                var widgetDictionary = handles.reader.queryArrayObject(kidsArray, value).toPDFDictionary();
                var apDictionary = handles.reader.queryDictionaryObject(widgetDictionary, 'AP').toPDFDictionary();
                var nAppearances = handles.reader.queryDictionaryObject(apDictionary, 'N').toPDFDictionary().toJSObject();
                appearanceName = _.find(Object.keys(nAppearances), function (item) { return item !== 'Off'; });
            }
            // set the V value on the new field dictionary
            modifiedDict
                .writeKey('V')
                .writeNameValue(appearanceName);
            // write the kids array, similar to writeFilledFields, 
            // but knowing that these are widgets and that AS needs to be set
            var fieldsReferences = this.writeKidsAndEndObject(handles, modifiedDict, kidsArray);
            // recreate widget kids, turn on or off based on their relation to the target value
            for (var i = 0; i < fieldsReferences.length; ++i) {
                var fieldReference = fieldsReferences[i];
                var sourceField = void 0;
                if (fieldReference.existing) {
                    handles.objectsContext.startModifiedIndirectObject(fieldReference.id);
                    sourceField = handles.reader.parseNewObject(fieldReference.id).toPDFDictionary();
                }
                else {
                    handles.objectsContext.startNewIndirectObject(fieldReference.id);
                    sourceField = fieldReference.field.toPDFDictionary();
                }
                var modifiedFieldDict = this.startModifiedDictionary(handles, sourceField, { 'AS': -1 });
                if (value === i) {
                    // this widget should be on
                    modifiedFieldDict
                        .writeKey('AS')
                        .writeNameValue(appearanceName); // note that we have saved it earlier               
                }
                else {
                    // this widget should be off
                    modifiedFieldDict
                        .writeKey('AS')
                        .writeNameValue('Off');
                }
                // finish
                handles.objectsContext
                    .endDictionary(modifiedFieldDict)
                    .endIndirectObject();
            }
        }
    };
    PDFFormsFiller.prototype.writeAppearanceXObjectForText = function (handles, formId, fieldsDictionary, text, inheritedProperties) {
        var rect = handles.reader.queryDictionaryObject(fieldsDictionary, 'Rect').toPDFArray().toJSArray();
        var da = fieldsDictionary.exists('DA') ? fieldsDictionary.queryObject('DA').toString() :
            inheritedProperties('DA');
        // register to copy resources from form default resources dict 
        // [would have been better to just refer to it...but alas don't have access for xobject resources dict]
        if (handles.acroformDict.exists('DR')) {
            this.writer.getEvents().once('OnResourcesWrite', function (args) {
                // copy all but the keys that exist already
                var dr = handles.reader.queryDictionaryObject(handles.acroformDict, 'DR').toPDFDictionary().toJSObject();
                Object.getOwnPropertyNames(dr).forEach(function (element) {
                    if (element !== 'ProcSet') {
                        args.pageResourcesDictionaryContext.writeKey(element);
                        handles.copyingContext.copyDirectObjectAsIs(dr[element]);
                    }
                });
            });
        }
        var xobjectForm = this.writer.createFormXObject(0, 0, rect[2].value - rect[0].value, rect[3].value - rect[1].value, formId);
        // Will use Tj with "code" encoding to write the text, assuming encoding should work (??). 
        // if it won't i need real fonts here
        // and DA is not gonna be useful. so for now let's use as is.
        // For the same reason i'm not support Quad, as well.
        xobjectForm.getContentContext()
            .writeFreeCode('/Tx BMC\r\n')
            .q()
            .BT()
            .writeFreeCode(da + '\r\n')
            .Tj(text, { encoding: 'code' })
            .ET()
            .Q()
            .writeFreeCode('EMC');
        this.writer.endFormXObject(xobjectForm);
    };
    PDFFormsFiller.prototype.writeFieldWithAppearanceForText = function (handles, targetFieldDict, sourceFieldDictionary, appearanceInField, textToWrite, inheritedProperties) {
        // determine how to write appearance
        var newAppearanceFormId = handles.objectsContext.allocateNewObjectID();
        if (appearanceInField) {
            // Appearance in field - so write appearance dict in field
            targetFieldDict
                .writeKey('AP');
            var dict = handles.objectsContext.startDictionary();
            dict.writeKey("N").writeObjectReferenceValue(newAppearanceFormId);
            handles.objectsContext
                .endDictionary(dict)
                .endDictionary(targetFieldDict)
                .endIndirectObject();
        }
        else {
            // finish the field object
            handles.objectsContext
                .endDictionary(targetFieldDict)
                .endIndirectObject();
            // write in kid (there should be just one)
            var kidsArray = handles.reader.queryDictionaryObject(sourceFieldDictionary, 'Kids').toPDFArray();
            var fieldsReferences = this.writeKidsAndEndObject(handles, targetFieldDict, kidsArray);
            // recreate widget kid, with new stream reference
            var fieldReference = fieldsReferences[0];
            var sourceField;
            if (fieldReference.existing) {
                handles.objectsContext.startModifiedIndirectObject(fieldReference.id);
                sourceField = handles.reader.parseNewObject(fieldReference.id).toPDFDictionary();
            }
            else {
                handles.objectsContext.startNewIndirectObject(fieldReference.id);
                sourceField = fieldReference.field.toPDFDictionary();
            }
            var modifiedDict = this.startModifiedDictionary(handles, sourceField, { 'AP': -1 });
            modifiedDict
                .writeKey('AP');
            var apDict = handles.objectsContext.startDictionary();
            apDict.writeKey("N").writeObjectReferenceValue(newAppearanceFormId);
            handles.objectsContext
                .endDictionary(apDict)
                .endDictionary(modifiedDict)
                .endIndirectObject();
        }
        // write the new stream xobject
        this.writeAppearanceXObjectForText(handles, newAppearanceFormId, sourceFieldDictionary, textToWrite, inheritedProperties);
    };
    PDFFormsFiller.prototype.updateTextValue = function (handles, fieldDictionary, value, isRich, inheritedProperties) {
        if (typeof (value) === 'string') {
            value = { v: value, rv: value };
        }
        var appearanceInField = fieldDictionary.exists('Subtype')
            && (fieldDictionary.queryObject('Subtype').toString() === 'Widget')
            || !fieldDictionary.exists('Kids');
        var fieldsToRemove = { 'V': -1 };
        if (appearanceInField) {
            // add skipping AP if in field (and not in a child widget)
            fieldsToRemove['AP'] = -1;
        }
        if (isRich) {
            // skip RV if rich
            fieldsToRemove['RV'] = -1;
        }
        var modifiedDict = this.startModifiedDictionary(handles, fieldDictionary, fieldsToRemove);
        // start with value, setting both plain value and rich value
        modifiedDict
            .writeKey('V')
            .writeLiteralStringValue(new hummus.PDFTextString(value['v']).toBytesArray());
        if (isRich) {
            modifiedDict
                .writeKey('RV')
                .writeLiteralStringValue(new hummus.PDFTextString(value['rv']).toBytesArray());
        }
        this.writeFieldWithAppearanceForText(handles, modifiedDict, fieldDictionary, appearanceInField, value['v'], inheritedProperties);
    };
    PDFFormsFiller.prototype.updateChoiceValue = function (handles, fieldDictionary, value, inheritedProperties) {
        var appearanceInField = fieldDictionary.exists('Subtype')
            && (fieldDictionary.queryObject('Subtype').toString() === 'Widget')
            || !fieldDictionary.exists('Kids');
        var fieldsToRemove = { 'V': -1 };
        if (appearanceInField) {
            // add skipping AP if in field (and not in a child widget)
            fieldsToRemove['AP'] = -1;
        }
        var modifiedDict = this.startModifiedDictionary(handles, fieldDictionary, fieldsToRemove);
        // start with value, setting per one or multiple selection. also choose the text to write in appearance
        var textToWrite;
        if (typeof (value) === 'string') {
            // one option
            modifiedDict
                .writeKey('V')
                .writeLiteralStringValue(new hummus.PDFTextString(value).toBytesArray());
            textToWrite = value;
        }
        else {
            // multiple options
            modifiedDict
                .writeKey('V');
            handles.objectsContext.startArray();
            value.forEach(function (singleValue) {
                handles.objectsContext.writeLiteralString(new hummus.PDFTextString(singleValue).toBytesArray());
            });
            handles.objectsContext.endArray();
            textToWrite = value.length > 0 ? value[0] : '';
        }
        this.writeFieldWithAppearanceForText(handles, modifiedDict, fieldDictionary, appearanceInField, textToWrite, inheritedProperties);
    };
    /**
    * Update a field. splits to per type functions
    */
    PDFFormsFiller.prototype.updateFieldWithValue = function (handles, fieldDictionary, value, inheritedProperties) {
        // Update a field with value. There is a logical assumption made here:
        // This must be a terminal field. meaning it is a field, and it either has no kids, it also holding
        // Widget data or that it has one or more kids defining its widget annotation(s). Normally it would be
        // One but in the case of a radio button, where there's one per option.
        var localFieldType = fieldDictionary.exists('FT') ? fieldDictionary.queryObject('FT').toString() : undefined;
        var fieldType = localFieldType || inheritedProperties['FT'];
        var localFlags = fieldDictionary.exists('Ff') ? fieldDictionary.queryObject('Ff').toNumber() : undefined;
        var flags = localFlags === undefined ? inheritedProperties['Ff'] : localFlags;
        // the rest is fairly type dependent, so let's check the type
        switch (fieldType) {
            case 'Btn': {
                // tslint:disable-next-line:no-bitwise
                if ((flags >> 16) & 1) {
                    // push button. can't write a value. forget it.
                    this.defaultTerminalFieldWrite(handles, fieldDictionary);
                }
                else {
                    // checkbox or radio button
                    // tslint:disable-next-line:no-bitwise
                    this.updateOptionButtonValue(handles, fieldDictionary, (flags >> 15) & 1 ? value : (value ? 0 : null));
                }
                break;
            }
            case 'Tx': {
                // rich or plain text
                // tslint:disable-next-line:no-bitwise
                this.updateTextValue(handles, fieldDictionary, value, (flags >> 25) & 1, inheritedProperties);
                break;
            }
            case 'Ch': {
                this.updateChoiceValue(handles, fieldDictionary, value, inheritedProperties);
                break;
            }
            case 'Sig': {
                // signature, ain't handling that. should return or throw an error sometimes
                this.defaultTerminalFieldWrite(handles, fieldDictionary);
                break;
            }
            default: {
                // in case there's a fault and there's no type, or it's irrelevant
                this.defaultTerminalFieldWrite(handles, fieldDictionary);
            }
        }
    };
    PDFFormsFiller.prototype.writeFieldAndKids = function (handles, fieldDictionary, inheritedProperties, baseFieldName) {
        // this field or widget doesn't need value rewrite. 
        // but its kids might. so write the dictionary as is, dropping kids.
        // write them later and recurse.
        var modifiedFieldDict = this.startModifiedDictionary(handles, fieldDictionary, { 'Kids': -1 });
        // if kids exist, continue to them for extra filling!
        var kids = fieldDictionary.exists('Kids') ?
            handles.reader.queryDictionaryObject(fieldDictionary, 'Kids').toPDFArray() :
            null;
        if (kids) {
            var localEnv = {};
            // prep some inherited values and push env
            if (fieldDictionary.exists('FT')) {
                localEnv['FT'] = fieldDictionary.queryObject('FT').toString();
            }
            if (fieldDictionary.exists('Ff')) {
                localEnv['Ff'] = fieldDictionary.queryObject('Ff').toNumber();
            }
            if (fieldDictionary.exists('DA')) {
                localEnv['DA'] = fieldDictionary.queryObject('DA').toString();
            }
            if (fieldDictionary.exists('Opt')) {
                localEnv['Opt'] = fieldDictionary.queryObject('Opt').toPDFArray();
            }
            modifiedFieldDict.writeKey('Kids');
            // recurse to kids. note that this will take care of ending this object
            this.writeFilledFields(handles, modifiedFieldDict, kids, _.extend({}, inheritedProperties, localEnv), baseFieldName + '.');
        }
        else {
            // no kids, can finish object now
            handles.objectsContext
                .endDictionary(modifiedFieldDict)
                .endIndirectObject();
        }
    };
    /**
    * writes a single field. will fill with value if found in data.
    * assuming that's in indirect object and having to write the dict,finish the dict, indirect object and write the kids
    */
    PDFFormsFiller.prototype.writeFilledField = function (handles, fieldDictionary, inheritedProperties, baseFieldName) {
        var localFieldNameT = fieldDictionary.exists('T') ? this.toText(fieldDictionary.queryObject('T')) : undefined;
        var fullName = localFieldNameT === undefined ? baseFieldName : (baseFieldName + localFieldNameT);
        // Based on the fullName we can now determine whether the field has a value that needs setting
        if (handles.data[fullName]) {
            // We got a winner! write with updated value
            this.updateFieldWithValue(handles, fieldDictionary, handles.data[fullName], inheritedProperties);
        }
        else {
            // Not yet. write and recurse to kids
            this.writeFieldAndKids(handles, fieldDictionary, inheritedProperties, fullName);
        }
    };
    /**
    * Write kids array converting each direct kids to an indirect one
    */
    PDFFormsFiller.prototype.writeKidsAndEndObject = function (handles, parentDict, kidsArray) {
        var fieldsReferences = [];
        var fieldJSArray = kidsArray.toJSArray();
        handles.objectsContext.startArray();
        fieldJSArray.forEach(function (field) {
            if (field.getType() === hummus.ePDFObjectIndirectObjectReference) {
                // existing reference, keep as is
                handles.copyingContext.copyDirectObjectAsIs(field);
                fieldsReferences.push({ existing: true, id: field.toPDFIndirectObjectReference().getObjectID() });
            }
            else {
                var newFieldObjectId = handles.objectsContext.allocateNewObjectID();
                // direct object, recreate as reference
                fieldsReferences.push({ existing: false, id: newFieldObjectId, theObject: field });
                handles.copyingContext.writeIndirectObjectReference(newFieldObjectId);
            }
        });
        handles.objectsContext
            .endArray(hummus.eTokenSeparatorEndLine)
            .endDictionary(parentDict)
            .endIndirectObject();
        return fieldsReferences;
    };
    /**
    * write fields/kids array of dictionary. make sure all become indirect, for the sake of simplicity,
    * which is why it gets to take care of finishing the writing of the said dict
    */
    PDFFormsFiller.prototype.writeFilledFields = function (handles, parentDict, fields, inheritedProperties, baseFieldName) {
        var _this = this;
        var fieldsReferences = this.writeKidsAndEndObject(handles, parentDict, fields);
        // now recreate the fields, filled this time (and down the recursion hole...)
        fieldsReferences.forEach(function (fieldReference) {
            if (fieldReference.existing) {
                handles.objectsContext.startModifiedIndirectObject(fieldReference.id);
                _this.writeFilledField(handles, handles.reader.parseNewObject(fieldReference.id).toPDFDictionary(), inheritedProperties, baseFieldName);
            }
            else {
                handles.objectsContext.startNewIndirectObject(fieldReference.id);
                _this.writeFilledField(handles, fieldReference.field.toPDFDictionary(), inheritedProperties, baseFieldName);
            }
        });
    };
    /**
    * Write a filled form dictionary, and its subordinate fields.
    * assumes in an indirect object, so will finish it
    */
    PDFFormsFiller.prototype.writeFilledForm = function (handles, acroformDict) {
        var modifiedAcroFormDict = this.startModifiedDictionary(handles, acroformDict, { 'Fields': -1 });
        var fields = acroformDict.exists('Fields') ?
            handles.reader.queryDictionaryObject(acroformDict, 'Fields').toPDFArray() :
            null;
        if (fields) {
            modifiedAcroFormDict.writeKey('Fields');
            this.writeFilledFields(handles, modifiedAcroFormDict, fields, {}, '');
        }
        else {
            handles
                .objectsContext.endDictionary(modifiedAcroFormDict)
                .objectsContext.endIndirectObject();
        }
    };
    return PDFFormsFiller;
})();
exports.PDFFormsFiller = PDFFormsFiller;
