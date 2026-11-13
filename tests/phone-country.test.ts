import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phoneCountry} from '../packages/domain/phone-country';
test('phone countries resolve national numbering plans, not shared calling codes alone',()=>{
 assert.equal(phoneCountry(['8613800138000@s.whatsapp.net']),'CN');
 assert.equal(phoneCountry(['12025550123@s.whatsapp.net']),'US');
 assert.equal(phoneCountry(['14165550123@s.whatsapp.net']),'CA');
});
test('opaque LIDs and unresolved or conflicting numbers are never guessed',()=>{
 assert.equal(phoneCountry(['8613800138000@lid']),'');
 assert.equal(phoneCountry(['123@s.whatsapp.net']),'');
 assert.equal(phoneCountry(['19995550123@s.whatsapp.net']),'');
 assert.equal(phoneCountry(['8613800138000@lid','14165550123@s.whatsapp.net']),'CA');
 assert.equal(phoneCountry(['8613800138000@s.whatsapp.net','14165550123@s.whatsapp.net']),'');
});
