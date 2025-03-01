#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Based upon makeunicodedata.py
# (http://hg.python.org/cpython/file/c8192197d23d/Tools/unicode/makeunicodedata.py)
# written by Fredrik Lundh (fredrik@pythonware.com)
#
#    Copyright (C) 2011 Tom Schuster <evilpies@gmail.com>
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    You should have received a copy of the GNU General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.

from __future__ import print_function
import csv
import io
import re
import os
import sys
from contextlib import closing

# ECMAScript 2016
# §11.2 White Space
whitespace = [
    # python doesn't support using control character names :(
    0x9, # CHARACTER TABULATION
    0xb, # LINE TABULATION
    0xc, # FORM FEED
    ord(u'\N{SPACE}'),
    ord(u'\N{NO-BREAK SPACE}'),
    ord(u'\N{ZERO WIDTH NO-BREAK SPACE}'), # also BOM
]

# §11.3 Line Terminators
line_terminator = [
    0xa, # LINE FEED
    0xd, # CARRIAGE RETURN
    ord(u'\N{LINE SEPARATOR}'),
    ord(u'\N{PARAGRAPH SEPARATOR}'),
]

# These are also part of IdentifierPart §11.6 Names and Keywords
compatibility_identifier_part = [
    ord(u'\N{ZERO WIDTH NON-JOINER}'),
    ord(u'\N{ZERO WIDTH JOINER}'),
]

FLAG_SPACE = 1 << 0
FLAG_UNICODE_ID_START = 1 << 1
FLAG_UNICODE_ID_CONTINUE_ONLY = 1 << 2

MAX_BMP = 0xffff

public_domain = """
/*
 * Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/licenses/publicdomain/
 */
"""

mpl_license = """\
/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=8 sts=4 et sw=4 tw=99:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"""

warning_message = """\
/* Generated by make_unicode.py DO NOT MODIFY */
"""

unicode_version_message = """\
/* Unicode version: {0} */
"""

casefold_version_message = """\
/* Casefold Unicode version: {0} */
"""

def read_unicode_data(unicode_data):
    """
        If you want to understand how this wonderful file format works checkout
          Unicode Standard Annex #44 - Unicode Character Database
          http://www.unicode.org/reports/tr44/
    """

    reader = csv.reader(unicode_data, delimiter=';')

    while True:
        row = reader.next()
        name = row[1]

        # We need to expand the UAX #44 4.2.3 Code Point Range
        if name.startswith('<') and name.endswith('First>'):
            next_row = reader.next()

            for i in range(int(row[0], 16), int(next_row[0], 16) + 1):
                row[0] = i
                row[1] = name[1:-8]

                yield row
        else:
            row[0] = int(row[0], 16)
            yield row

def read_case_folding(case_folding):
    for line in case_folding:
        if line == '\n' or line.startswith('#'):
            continue
        row = line.split('; ')
        if row[1] in ['F', 'T']:
            continue
        row[0] = int(row[0], 16)
        row[2] = int(row[2], 16)
        yield row

def read_derived_core_properties(derived_core_properties):
    for line in derived_core_properties:
        if line == '\n' or line.startswith('#'):
            continue
        row = line.split('#')[0].split(';')
        char_range = row[0].strip()
        char_property = row[1].strip()
        if '..' not in char_range:
            yield (int(char_range, 16), char_property)
        else:
            [start, end] = char_range.split('..')
            for char in range(int(start, 16), int(end, 16) + 1):
                yield (char, char_property)

def utf16_encode(code):
    NonBMPMin = 0x10000
    LeadSurrogateMin = 0xD800
    TrailSurrogateMin = 0xDC00

    lead = (code - NonBMPMin) / 1024 + LeadSurrogateMin
    trail = ((code - NonBMPMin) % 1024) + TrailSurrogateMin

    return lead, trail

def make_non_bmp_convert_macro(out_file, name, convert_map):
    convert_list = []
    entry = None
    for code in sorted(convert_map.keys()):
        converted = convert_map[code]
        diff = converted - code

        if entry and code == entry['code'] + entry['length'] and diff == entry['diff']:
            entry['length'] += 1
            continue

        entry = { 'code': code, 'diff': diff, 'length': 1 }
        convert_list.append(entry)

    lines = []
    for entry in convert_list:
        from_code = entry['code']
        to_code = entry['code'] + entry['length'] - 1
        diff = entry['diff']

        from_lead, from_trail = utf16_encode(from_code)
        to_lead, to_trail = utf16_encode(to_code)

        assert from_lead == to_lead

        lines.append('    macro(0x{:x}, 0x{:x}, 0x{:x}, 0x{:x}, 0x{:x}, {:d})'.format(
            from_code, to_code, from_lead, from_trail, to_trail, diff))

    out_file.write('#define FOR_EACH_NON_BMP_{}(macro) \\\n'.format(name))
    out_file.write(' \\\n'.join(lines))
    out_file.write('\n')

def process_derived_core_properties(derived_core_properties):
    id_start = set()
    id_continue = set()

    for (char, prop) in read_derived_core_properties(derived_core_properties):
        if prop == 'ID_Start':
            id_start.add(char)
        if prop == 'ID_Continue':
            id_continue.add(char)

    return (id_start, id_continue)

def process_unicode_data(unicode_data, derived_core_properties):
    dummy = (0, 0, 0)
    table = [dummy]
    cache = {dummy: 0}
    index = [0] * (MAX_BMP + 1)
    same_upper_map = {}
    same_upper_dummy = (0, 0, 0)
    same_upper_table = [same_upper_dummy]
    same_upper_cache = {same_upper_dummy: 0}
    same_upper_index = [0] * (MAX_BMP + 1)

    test_table = {}
    test_space_table = []

    non_bmp_lower_map = {}
    non_bmp_upper_map = {}

    (id_start, id_continue) = process_derived_core_properties(derived_core_properties)

    for row in read_unicode_data(unicode_data):
        code = row[0]
        name = row[1]
        category = row[2]
        alias = row[-5]
        uppercase = row[-3]
        lowercase = row[-2]
        flags = 0

        if uppercase:
            upper = int(uppercase, 16)

            if upper not in same_upper_map:
                same_upper_map[upper] = [code]
            else:
                same_upper_map[upper].append(code)
        else:
            upper = code

        if lowercase:
            lower = int(lowercase, 16)
        else:
            lower = code

        if code > MAX_BMP:
            if code != lower:
                non_bmp_lower_map[code] = lower
            if code != upper:
                non_bmp_upper_map[code] = upper
            continue

        # we combine whitespace and lineterminators because in pratice we don't need them separated
        if category == 'Zs' or code in whitespace or code in line_terminator:
            flags |= FLAG_SPACE
            test_space_table.append(code)

        # §11.6 (IdentifierStart)
        if code in id_start:
            flags |= FLAG_UNICODE_ID_START

        # §11.6 (IdentifierPart)
        elif code in id_continue or code in compatibility_identifier_part:
            flags |= FLAG_UNICODE_ID_CONTINUE_ONLY

        test_table[code] = (upper, lower, name, alias)

        up_d = upper - code
        low_d = lower - code

        assert up_d > -65535 and up_d < 65535
        assert low_d > -65535 and low_d < 65535

        upper = up_d & 0xffff
        lower = low_d & 0xffff

        item = (upper, lower, flags)

        i = cache.get(item)
        if i is None:
            assert item not in table
            cache[item] = i = len(table)
            table.append(item)
        index[code] = i

    for code in range(0, MAX_BMP + 1):
        entry = test_table.get(code)

        if not entry:
            continue

        (upper, lower, name, alias) = entry

        if upper not in same_upper_map:
            continue

        same_upper_ds = [v - code for v in same_upper_map[upper]]

        assert len(same_upper_ds) <= 3
        assert all([v > -65535 and v < 65535 for v in same_upper_ds])

        same_upper = [v & 0xffff for v in same_upper_ds]
        same_upper_0 = same_upper[0] if len(same_upper) >= 1 else 0
        same_upper_1 = same_upper[1] if len(same_upper) >= 2 else 0
        same_upper_2 = same_upper[2] if len(same_upper) >= 3 else 0

        item = (same_upper_0, same_upper_1, same_upper_2)

        i = same_upper_cache.get(item)
        if i is None:
            assert item not in same_upper_table
            same_upper_cache[item] = i = len(same_upper_table)
            same_upper_table.append(item)
        same_upper_index[code] = i

    return (
        table, index,
        same_upper_table, same_upper_index,
        non_bmp_lower_map, non_bmp_upper_map,
        test_table, test_space_table,
    )

def process_case_folding(case_folding):
    folding_map = {}
    rev_folding_map = {}
    folding_dummy = (0, 0, 0, 0)
    folding_table = [folding_dummy]
    folding_cache = {folding_dummy: 0}
    folding_index = [0] * (MAX_BMP + 1)

    folding_tests = []
    folding_codes = set()

    non_bmp_folding_map = {}
    non_bmp_rev_folding_map = {}

    for row in read_case_folding(case_folding):
        code = row[0]
        mapping = row[2]
        folding_map[code] = mapping

        if code > MAX_BMP:
            non_bmp_folding_map[code] = mapping
            non_bmp_rev_folding_map[mapping] = code

        if mapping not in rev_folding_map:
            rev_folding_map[mapping] = [code]
        else:
            rev_folding_map[mapping].append(code)

        folding_codes.add(code)
        folding_codes.add(mapping)

    for code in sorted(folding_codes):
        if code in folding_map:
            folding = folding_map[code]
        else:
            folding = code

        if code in rev_folding_map:
            rev_folding = rev_folding_map[code]
        elif folding in rev_folding_map:
            rev_folding = [c for c in rev_folding_map[folding] if c != code]
        else:
            rev_folding = []

        assert len(rev_folding) <= 3

        if folding != code or len(rev_folding):
            item = [code]
            if folding != code:
                item.append(folding)
            folding_tests.append(item + rev_folding)

        if code > MAX_BMP:
            continue

        folding_d = folding - code
        rev_folding_ds = [v - code for v in rev_folding]

        assert folding_d > -65535 and folding_d < 65535
        assert all([v > -65535 and v < 65535 for v in rev_folding])

        folding = folding_d & 0xffff
        rev_folding = [v & 0xffff for v in rev_folding_ds]
        rev_folding_0 = rev_folding[0] if len(rev_folding) >= 1 else 0
        rev_folding_1 = rev_folding[1] if len(rev_folding) >= 2 else 0
        rev_folding_2 = rev_folding[2] if len(rev_folding) >= 3 else 0

        item = (folding, rev_folding_0, rev_folding_1, rev_folding_2)

        i = folding_cache.get(item)
        if i is None:
            assert item not in folding_table
            folding_cache[item] = i = len(folding_table)
            folding_table.append(item)
        folding_index[code] = i
    return (
        folding_table, folding_index,
        non_bmp_folding_map, non_bmp_rev_folding_map,
        folding_tests
    )

def make_non_bmp_file(version, casefold_version,
                      non_bmp_lower_map, non_bmp_upper_map,
                      non_bmp_folding_map, non_bmp_rev_folding_map):
    file_name = 'UnicodeNonBMP.h';
    with io.open(file_name, mode='wb') as non_bmp_file:
        non_bmp_file.write(mpl_license)
        non_bmp_file.write('\n')
        non_bmp_file.write(warning_message)
        non_bmp_file.write(unicode_version_message.format(version))
        non_bmp_file.write(casefold_version_message.format(casefold_version))
        non_bmp_file.write("""
#ifndef vm_UnicodeNonBMP_h
#define vm_UnicodeNonBMP_h

""")

        make_non_bmp_convert_macro(non_bmp_file, 'LOWERCASE', non_bmp_lower_map)
        non_bmp_file.write('\n')
        make_non_bmp_convert_macro(non_bmp_file, 'UPPERCASE', non_bmp_upper_map)
        non_bmp_file.write('\n')
        make_non_bmp_convert_macro(non_bmp_file, 'CASE_FOLDING', non_bmp_folding_map)
        non_bmp_file.write('\n')
        make_non_bmp_convert_macro(non_bmp_file, 'REV_CASE_FOLDING', non_bmp_rev_folding_map)

        non_bmp_file.write("""
#endif /* vm_UnicodeNonBMP_h */
""")

def make_bmp_mapping_test(version, test_table):
    file_name = '../tests/ecma_5/String/string-upper-lower-mapping.js'
    with io.open(file_name, mode='wb') as test_mapping:
        test_mapping.write(warning_message)
        test_mapping.write(unicode_version_message.format(version))
        test_mapping.write(public_domain)
        test_mapping.write('var mapping = [\n')
        for code in range(0, MAX_BMP + 1):
            entry = test_table.get(code)

            if entry:
                (upper, lower, name, alias) = entry
                test_mapping.write('  [' + hex(upper) + ', ' + hex(lower) + '], /* ' +
                        name + (' (' + alias + ')' if alias else '') + ' */\n')
            else:
                test_mapping.write('  [' + hex(code) + ', ' + hex(code) + '],\n')
        test_mapping.write('];')
        test_mapping.write("""
assertEq(mapping.length, 0x10000);
for (var i = 0; i <= 0xffff; i++) {
    var char = String.fromCharCode(i);
    var info = mapping[i];

    assertEq(char.toUpperCase().charCodeAt(0), info[0]);
    assertEq(char.toLowerCase().charCodeAt(0), info[1]);
}

if (typeof reportCompare === "function")
    reportCompare(true, true);
""")

def make_non_bmp_mapping_test(version, non_bmp_upper_map, non_bmp_lower_map):
    file_name = '../tests/ecma_6/String/string-code-point-upper-lower-mapping.js'
    with io.open(file_name, mode='wb') as test_non_bmp_mapping:
        test_non_bmp_mapping.write(warning_message)
        test_non_bmp_mapping.write(unicode_version_message.format(version))
        test_non_bmp_mapping.write(public_domain)
        for code in sorted(non_bmp_upper_map.keys()):
            test_non_bmp_mapping.write("""\
assertEq(String.fromCodePoint(0x{:x}).toUpperCase().codePointAt(0), 0x{:x});
""".format(code, non_bmp_upper_map[code]))
        for code in sorted(non_bmp_lower_map.keys()):
            test_non_bmp_mapping.write("""\
assertEq(String.fromCodePoint(0x{:x}).toLowerCase().codePointAt(0), 0x{:x});
""".format(code, non_bmp_lower_map[code]))

        test_non_bmp_mapping.write("""
if (typeof reportCompare === "function")
    reportCompare(true, true);
""")

def make_space_test(version, test_space_table):
    file_name = '../tests/ecma_5/String/string-space-trim.js'
    with io.open(file_name, mode='wb') as test_space:
        test_space.write(warning_message)
        test_space.write(unicode_version_message.format(version))
        test_space.write(public_domain)
        test_space.write('var onlySpace = String.fromCharCode(' +
                        ', '.join(map(lambda c: hex(c), test_space_table)) + ');\n')
        test_space.write("""
assertEq(onlySpace.trim(), "");
assertEq((onlySpace + 'aaaa').trim(), 'aaaa');
assertEq(('aaaa' + onlySpace).trim(), 'aaaa');
assertEq((onlySpace + 'aaaa' + onlySpace).trim(), 'aaaa');

if (typeof reportCompare === "function")
    reportCompare(true, true);
""")

def make_icase_test(version, folding_tests):
    file_name = '../tests/ecma_6/RegExp/unicode-ignoreCase.js'
    with io.open(file_name, mode='wb') as test_icase:
        test_icase.write(warning_message)
        test_icase.write(unicode_version_message.format(version))
        test_icase.write(public_domain)
        test_icase.write("""
var BUGNUMBER = 1135377;
var summary = "Implement RegExp unicode flag -- ignoreCase flag.";

print(BUGNUMBER + ": " + summary);

function test(code, ...equivs) {
  var codeRe = new RegExp(String.fromCodePoint(code) + "+", "iu");
  var ans = String.fromCodePoint(code) + equivs.map(c => String.fromCodePoint(c)).join("");
  assertEqArray(codeRe.exec("<" + ans + ">"), [ans]);
  codeRe = new RegExp("[" + String.fromCodePoint(code) + "]+", "iu");
  assertEqArray(codeRe.exec("<" + ans + ">"), [ans]);
}
""")
        for args in folding_tests:
            test_icase.write('test(' + ','.join([hex(c) for c in args]) + ');\n')
        test_icase.write("""
if (typeof reportCompare === "function")
    reportCompare(true, true);
""")

def make_unicode_file(version, casefold_version,
                      table, index,
                      same_upper_table, same_upper_index,
                      folding_table, folding_index):
    index1, index2, shift = splitbins(index)

    # Don't forget to update CharInfo in Unicode.h if you need to change this
    assert shift == 5

    same_upper_index1, same_upper_index2, same_upper_shift = splitbins(same_upper_index)

    # Don't forget to update CodepointsWithSameUpperCaseInfo in Unicode.h if you need to change this
    assert same_upper_shift == 6

    folding_index1, folding_index2, folding_shift = splitbins(folding_index)

    # Don't forget to update CaseFoldInfo in Unicode.h if you need to change this
    assert folding_shift == 6

    # verify correctness
    for char in index:
        test = table[index[char]]

        idx = index1[char >> shift]
        idx = index2[(idx << shift) + (char & ((1 << shift) - 1))]

        assert test == table[idx]

    # verify correctness
    for char in same_upper_index:
        test = same_upper_table[same_upper_index[char]]

        idx = same_upper_index1[char >> same_upper_shift]
        idx = same_upper_index2[(idx << same_upper_shift) + (char & ((1 << same_upper_shift) - 1))]

        assert test == same_upper_table[idx]

    # verify correctness
    for char in folding_index:
        test = folding_table[folding_index[char]]

        idx = folding_index1[char >> folding_shift]
        idx = folding_index2[(idx << folding_shift) + (char & ((1 << folding_shift) - 1))]

        assert test == folding_table[idx]

    comment = """
/*
 * So how does indexing work?
 * First let's have a look at a char16_t, 16-bits:
 *              [................]
 * Step 1:
 *  Extracting the upper 11 bits from the char16_t.
 *   upper = char >>  5 ([***********.....])
 * Step 2:
 *  Using these bits to get an reduced index from index1.
 *   index = index1[upper]
 * Step 3:
 *  Combining the index and the bottom 5 bits of the original char16_t.
 *   real_index = index2[(index << 5) + (char & ((1 << 5) - 1))] ([...********+++++])
 *
 * The advantage here is that the biggest number in index1 doesn't need 10 bits,
 * but 7 and we save some memory.
 *
 * Step 4:
 *  Get the character informations by looking up real_index in js_charinfo.
 *
 * Pseudocode of generation:
 *
 * let table be the mapping of char16_t => js_charinfo_index
 * let index1 be an empty array
 * let index2 be an empty array
 * let cache be a hash map
 *
 * while shift is less then maximal amount you can shift 0xffff before it's 0
 *  let chunks be table split in chunks of size 2**shift
 *
 *  for every chunk in chunks
 *   if chunk is in cache
 *    let index be cache[chunk]
 *   else
 *    let index be the max key of index2 + 1
 *    for element in chunk
 *     push element to index2
 *    put index as chunk in cache
 *
 *   push index >> shift to index1
 *
 *  increase shift
 *  stop if you found the best shift
 */
"""
    def dump(data, name, file):
        file.write('const uint8_t unicode::' + name + '[] = {\n')

        line = pad = ' ' * 4
        lines = []
        for entry in data:
            assert entry < 256
            s = str(entry)
            s = s.rjust(3)

            if len(line + s) + 5 > 99:
                lines.append(line.rstrip())
                line = pad + s + ', '
            else:
                line = line + s + ', '
        lines.append(line.rstrip())

        file.write('\n'.join(lines))
        file.write('\n};\n')

    file_name = 'Unicode.cpp'
    with io.open(file_name, 'wb') as data_file:
        data_file.write(warning_message)
        data_file.write(unicode_version_message.format(version))
        data_file.write(casefold_version_message.format(casefold_version))
        data_file.write(public_domain)
        data_file.write('#include "vm/Unicode.h"\n\n')
        data_file.write('using namespace js;\n')
        data_file.write('using namespace js::unicode;\n')
        data_file.write(comment)
        data_file.write('const CharacterInfo unicode::js_charinfo[] = {\n')
        for d in table:
            data_file.write('    {')
            data_file.write(', '.join((str(e) for e in d)))
            data_file.write('},\n')
        data_file.write('};\n')
        data_file.write('\n')

        dump(index1, 'index1', data_file)
        data_file.write('\n')
        dump(index2, 'index2', data_file)
        data_file.write('\n')

        data_file.write('const CodepointsWithSameUpperCaseInfo unicode::js_codepoints_with_same_upper_info[] = {\n')
        for d in same_upper_table:
            data_file.write('    {')
            data_file.write(', '.join((str(e) for e in d)))
            data_file.write('},\n')
        data_file.write('};\n')
        data_file.write('\n')

        dump(same_upper_index1, 'codepoints_with_same_upper_index1', data_file)
        data_file.write('\n')
        dump(same_upper_index2, 'codepoints_with_same_upper_index2', data_file)
        data_file.write('\n')

        data_file.write('const FoldingInfo unicode::js_foldinfo[] = {\n')
        for d in folding_table:
            data_file.write('    {')
            data_file.write(', '.join((str(e) for e in d)))
            data_file.write('},\n')
        data_file.write('};\n')
        data_file.write('\n')

        dump(folding_index1, 'folding_index1', data_file)
        data_file.write('\n')
        dump(folding_index2, 'folding_index2', data_file)
        data_file.write('\n')

def getsize(data):
    """ return smallest possible integer size for the given array """
    maxdata = max(data)
    assert maxdata < 2**32

    if maxdata < 256:
        return 1
    elif maxdata < 65536:
        return 2
    else:
        return 4

def splitbins(t):
    """t -> (t1, t2, shift).  Split a table to save space.

    t is a sequence of ints.  This function can be useful to save space if
    many of the ints are the same.  t1 and t2 are lists of ints, and shift
    is an int, chosen to minimize the combined size of t1 and t2 (in C
    code), and where for each i in range(len(t)),
        t[i] == t2[(t1[i >> shift] << shift) + (i & mask)]
    where mask is a bitmask isolating the last "shift" bits.
    """

    def dump(t1, t2, shift, bytes):
        print("%d+%d bins at shift %d; %d bytes" % (
            len(t1), len(t2), shift, bytes), file=sys.stderr)
        print("Size of original table:", len(t)*getsize(t), \
            "bytes", file=sys.stderr)
    n = len(t)-1    # last valid index
    maxshift = 0    # the most we can shift n and still have something left
    if n > 0:
        while n >> 1:
            n >>= 1
            maxshift += 1
    del n
    bytes = sys.maxsize  # smallest total size so far
    t = tuple(t)    # so slices can be dict keys
    for shift in range(maxshift + 1):
        t1 = []
        t2 = []
        size = 2**shift
        bincache = {}

        for i in range(0, len(t), size):
            bin = t[i:i + size]

            index = bincache.get(bin)
            if index is None:
                index = len(t2)
                bincache[bin] = index
                t2.extend(bin)
            t1.append(index >> shift)

        # determine memory size
        b = len(t1) * getsize(t1) + len(t2) * getsize(t2)
        if b < bytes:
            best = t1, t2, shift
            bytes = b
    t1, t2, shift = best

    print("Best:", end=' ', file=sys.stderr)
    dump(t1, t2, shift, bytes)

    # exhaustively verify that the decomposition is correct
    mask = 2**shift - 1
    for i in range(len(t)):
        assert t[i] == t2[(t1[i >> shift] << shift) + (i & mask)]
    return best

def update_unicode(args):
    import urllib2

    def to_download_url(version):
        baseurl = 'http://unicode.org/Public'
        if version is 'UNIDATA':
            return '%s/%s' % (baseurl, version)
        return '%s/%s/ucd' % (baseurl, version)

    unicode_info = {
        'name': 'Unicode',
        'version': args.version,
        'url': to_download_url(args.version),
    }
    # TODO: Remove this dict and use a single Unicode version when bug 1230490 has relanded.
    casefold_info = {
        'name': 'Casefold Unicode',
        'version': args.casefold_version,
        'url': to_download_url(args.casefold_version),
    }

    def print_info(info):
        if info['version'] is not None:
            print('\t%s version: %s' % (info['name'], info['version']))
            print('\t%s download url: %s' % (info['name'], info['url']))
        else:
            print('\t%s uses local files.' % info['name'])
            print('\tAlways make sure you have the newest Unicode files!')

    print('Arguments:')
    print_info(unicode_info)
    print_info(casefold_info)
    print('')

    def download_or_open(info, fname):
        tfile_path = os.path.join(os.getcwd(), fname)
        if info['version'] is not None:
            print('Downloading %s...' % fname)
            unicode_data_url = '%s/%s' % (info['url'], fname)
            with closing(urllib2.urlopen(unicode_data_url)) as reader:
                data = reader.read()
            tfile = io.open(tfile_path, 'w+b')
            tfile.write(data)
            tfile.flush()
            tfile.seek(0)
        else:
            if not os.path.isfile(tfile_path):
                raise RuntimeError('File not found: %s' % tfile_path)
            tfile = io.open(tfile_path, 'rb');
        return tfile

    def version_from_file(f, fname):
        pat_version = re.compile(r"# %s-(?P<version>\d+\.\d+\.\d+).txt" % fname)
        (unicode_version) = pat_version.match(f.readline()).group("version")
        return unicode_version

    with download_or_open(unicode_info, 'UnicodeData.txt') as unicode_data, \
         download_or_open(casefold_info, 'CaseFolding.txt') as case_folding, \
         download_or_open(unicode_info, 'DerivedCoreProperties.txt') as derived_core_properties:
        version = version_from_file(derived_core_properties, 'DerivedCoreProperties')
        casefold_version = version_from_file(case_folding, 'CaseFolding')

        print('Processing...')
        (
            table, index,
            same_upper_table, same_upper_index,
            non_bmp_lower_map, non_bmp_upper_map,
            test_table, test_space_table
        ) = process_unicode_data(unicode_data, derived_core_properties)
        (
            folding_table, folding_index,
            non_bmp_folding_map, non_bmp_rev_folding_map,
            folding_tests
        ) = process_case_folding(case_folding)

    print('Generating...')
    make_unicode_file(version, casefold_version,
                      table, index,
                      same_upper_table, same_upper_index,
                      folding_table, folding_index)
    make_non_bmp_file(version, casefold_version,
                      non_bmp_lower_map, non_bmp_upper_map,
                      non_bmp_folding_map, non_bmp_rev_folding_map)

    make_bmp_mapping_test(version, test_table)
    make_non_bmp_mapping_test(version, non_bmp_upper_map, non_bmp_lower_map)
    make_space_test(version, test_space_table)
    make_icase_test(casefold_version, folding_tests)

if __name__ == '__main__':
    import argparse

    # This script must be run from js/src/vm to work correctly.
    if '/'.join(os.path.normpath(os.getcwd()).split(os.sep)[-3:]) != 'js/src/vm':
        raise RuntimeError('%s must be run from js/src/vm' % sys.argv[0])

    # !!! IMPORTANT !!!
    # We currently use two different Unicode versions (6.2 and 8.0) for
    # separate parts of the engine. This is all just temporary until
    # bug 1230490 has relanded. As soon as bug 1230490 has relanded, this
    # script can be simplified by removing all logic to handle different
    # Unicode versions.

    parser = argparse.ArgumentParser(description='Update Unicode data.')

    parser.add_argument('--version',
                        help='Optional Unicode version number. If specified, downloads the\
                              selected version from <http://unicode.org/Public>. If not specified\
                              uses the existing local files to generate the Unicode data. The\
                              number must match a published Unicode version, e.g. use\
                              "--version=8.0.0" to download Unicode 8 files. Alternatively use\
                              "--version=UNIDATA" to download the latest published version.')
    # TODO: Remove this parameter when bug 1230490 has relanded.
    parser.add_argument('--casefold-version',
                        help='Unicode version number for case-folding data. Has the same meaning\
                        as --version, except only used for case-folding data.')

    parser.set_defaults(func=update_unicode)

    args = parser.parse_args()
    args.func(args)
