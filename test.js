var ReedSolomon = require('./index.js');
var Node = { crypto: require('crypto') };
var Test = {};

Test.equal = function(value, expected, namespace, description) {
  value = JSON.stringify(value) + '';
  expected = JSON.stringify(expected) + '';
  if (value === expected) {
    Test.pass(namespace, description, expected);
  } else {
    Test.fail(namespace, description, value + ' !== ' + expected);
  }
};

Test.fail = function(namespace, description, message) {
  console.log('');
  throw 'FAIL: ' + Test.message(namespace, description, message);
};

Test.message = function(namespace, description, message) {
  if ((namespace = namespace || '')) namespace += ': ';
  if ((description = description || '')) description += ': ';
  return namespace + description + (message || '');
};

Test.pass = function(namespace, description, message) {
  console.log('PASS: ' + Test.message(namespace, description, message));
};

var rs = new ReedSolomon(2, 1);
var shards = [
  new Buffer(0),
  new Buffer(0),
  new Buffer(0)
];
rs.encode(shards, 0, 0);
Test.equal(shards.length, 3, 'ReedSolomon', 'zero encode shards.length');
Test.equal(shards[0].length, 0, 'ReedSolomon', 'zero encode shards[0].length');
Test.equal(shards[1].length, 0, 'ReedSolomon', 'zero encode shards[1].length');
Test.equal(shards[2].length, 0, 'ReedSolomon', 'zero encode shards[2].length');

var rs = new ReedSolomon(5, 5);
var shards = [
  new Buffer([0, 1]),
  new Buffer([4, 5]),
  new Buffer([2, 3]),
  new Buffer([6, 7]),
  new Buffer([8, 9]),
  new Buffer([0, 0]),
  new Buffer([0, 0]),
  new Buffer([0, 0]),
  new Buffer([0, 0]),
  new Buffer([0, 0])
];
rs.encode(shards, 0, 2);
Test.equal(shards[0], new Buffer([0, 1]), 'ReedSolomon', 'shard 0');
Test.equal(shards[1], new Buffer([4, 5]), 'ReedSolomon', 'shard 1');
Test.equal(shards[2], new Buffer([2, 3]), 'ReedSolomon', 'shard 2');
Test.equal(shards[3], new Buffer([6, 7]), 'ReedSolomon', 'shard 3');
Test.equal(shards[4], new Buffer([8, 9]), 'ReedSolomon', 'shard 4');
Test.equal(shards[5], new Buffer([12, 13]), 'ReedSolomon', 'shard 5');
Test.equal(shards[6], new Buffer([10, 11]), 'ReedSolomon', 'shard 6');
Test.equal(shards[7], new Buffer([14, 15]), 'ReedSolomon', 'shard 7');
Test.equal(shards[8], new Buffer([90, 91]), 'ReedSolomon', 'shard 8');
Test.equal(shards[9], new Buffer([94, 95]), 'ReedSolomon', 'shard 9');
var temp = new Buffer([0, 0]);
Test.equal(
  rs.isParityCorrect(shards, 0, 2, temp),
  true,
  'ReedSolomon',
  'isParityCorrect'
);
shards[8][0] += 1;
Test.equal(
  rs.isParityCorrect(shards, 0, 2, temp),
  false,
  'ReedSolomon',
  'isParityCorrect'
);

var actual = ReedSolomon.Matrix.identity(3).toString();
var expect = '[[1, 0, 0], [0, 1, 0], [0, 0, 1]]';
Test.equal(actual, expect, 'Matrix', 'identity(3).toString()');

var m1 = new ReedSolomon.Matrix([
  new Buffer([1, 2]),
  new Buffer([3, 4])
]);
var m2 = new ReedSolomon.Matrix([
  new Buffer([5, 6]),
  new Buffer([7, 8])
]);
var actual = m1.times(m2).toString();
var expect = '[[11, 22], [19, 42]]';
Test.equal(actual, expect, 'Matrix', 'times');

var m = new ReedSolomon.Matrix([
  new Buffer([56, 23, 98]),
  new Buffer([3, 100, 200]),
  new Buffer([45, 201, 123])
]);
Test.equal(
  m.invert().toString(),
  "[[175, 133, 33], [130, 13, 245], [112, 35, 126]]",
  'Matrix',
  'invert'
);
Test.equal(
  m.times(m.invert()).toString(),
  ReedSolomon.Matrix.identity(3).toString(),
  'Matrix',
  'invert'
);

var m = new ReedSolomon.Matrix([
  new Buffer([1, 0, 0, 0, 0]),
  new Buffer([0, 1, 0, 0, 0]),
  new Buffer([0, 0, 0, 1, 0]),
  new Buffer([0, 0, 0, 0, 1]),
  new Buffer([7, 7, 6, 6, 1])
]);
var expected = '[' + [
  '[1, 0, 0, 0, 0]',
  '[0, 1, 0, 0, 0]',
  '[123, 123, 1, 122, 122]',
  '[0, 0, 1, 0, 0]',
  '[0, 0, 0, 1, 0]'
].join(', ') + ']';
Test.equal(m.invert().toString(), expected, 'Matrix', 'invert2');
Test.equal(
  m.times(m.invert()).toString(),
  ReedSolomon.Matrix.identity(5).toString(),
  'Matrix',
  'invert3'
);

var assertEqualsCount = 0;

function assertEquals(a, b, namespace, name, mod) {
  assertEqualsCount++;
  // We always assert that a and b are equal (using a !== b).
  // We only explicitly log these results every mod times.
  // We test millions of iterations so this helps the test to run faster.
  if (a !== b || (assertEqualsCount % mod) === 0) {
    Test.equal(a, b, namespace, name);
  }
}

function assertArrayEquals(a, b, namespace, name) {
  var passed = true;
  if (a.length !== b.length) {
    passed = false;
  } else {
    for (var index = 0, length = a.length; index < length; index++) {
      if (a[index] !== b[index]) {
        passed = false;
        break;
      }
    }
  }
  Test.equal(passed, true, namespace, name);
}

// Test associativity:
for (var a = 0; a < 256; a++) {
  for (var b = 0; b < 256; b++) {
    for (var c = 0; c < 256; c++) {
      assertEquals(
        ReedSolomon.Galois.add(a, ReedSolomon.Galois.add(b, c)),
        ReedSolomon.Galois.add(ReedSolomon.Galois.add(a, b), c),
        'Galois',
        'associativity',
        2000000
      );
      assertEquals(
        ReedSolomon.Galois.multiply(a, ReedSolomon.Galois.multiply(b, c)),
        ReedSolomon.Galois.multiply(ReedSolomon.Galois.multiply(a, b), c),
        'Galois',
        'associativity',
        2000000
      );
    }
  }
}

// Test identity:
for (var a = 0; a < 256; a++) {
  assertEquals(a, ReedSolomon.Galois.add(a, 0), 'Galois', 'identity', 32);
  assertEquals(a, ReedSolomon.Galois.multiply(a, 1), 'Galois', 'identity', 32);
}

// Test inverse:
for (var a = 0; a < 256; a++) {
  var b = ReedSolomon.Galois.subtract(0, a);
  assertEquals(0, ReedSolomon.Galois.add(a, b), 'Galois', 'inverse', 64);
  if (a !== 0) {
    var b = ReedSolomon.Galois.divide(1, a);
    assertEquals(1, ReedSolomon.Galois.multiply(a, b), 'Galois', 'inverse', 13);
  }
}

// Test commutativity:
for (var a = 0; a < 256; a++) {
  for (var b = 0; b < 256; b++) {
    assertEquals(
      ReedSolomon.Galois.add(a, b),
      ReedSolomon.Galois.add(b, a),
      'Galois',
      'commutativity',
      8192
    );
    assertEquals(
      ReedSolomon.Galois.multiply(a, b),
      ReedSolomon.Galois.multiply(b, a),
      'Galois',
      'commutativity',
      8192
    );
  }
}

// Test distributivity:
for (var a = 0; a < 256; a++) {
  for (var b = 0; b < 256; b++) {
    for (var c = 0; c < 256; c++) {
      assertEquals(
        ReedSolomon.Galois.multiply(a, ReedSolomon.Galois.add(b, c)),
        ReedSolomon.Galois.add(
          ReedSolomon.Galois.multiply(a, b),
          ReedSolomon.Galois.multiply(a, c)
        ),
        'Galois',
        'distributivity',
        2000000
      );
    }
  }
}

// Test exp:
for (var a = 0; a < 256; a++) {
  var power = 1;
  for (var j = 0; j < 256; j++) {
    assertEquals(
      power,
      ReedSolomon.Galois.exp(a, j),
      'Galois',
      'exp',
      4000
    );
    power = ReedSolomon.Galois.multiply(power, a);
  }
}

// Test log table generation:
var logTable = ReedSolomon.Galois.generateLogTable(
  ReedSolomon.Galois.GENERATING_POLYNOMIAL
);
assertArrayEquals(
  ReedSolomon.Galois.LOG_TABLE,
  logTable,
  'Galois',
  'log table'
);

// Test exp table generation:
var expTable = ReedSolomon.Galois.generateExpTable(logTable);
assertArrayEquals(
  ReedSolomon.Galois.EXP_TABLE,
  expTable,
  'Galois',
  'exp table'
);

// Test multiply table:
var table = ReedSolomon.Galois.MULTIPLY_TABLE;
for (var a = 0; a < 256; a++) {
  for (var b = 0; b < 256; b++) {
    assertEquals(
      ReedSolomon.Galois.multiply(a, b),
      table[a & 0xFF][b & 0xFF],
      'Galois',
      'mtable',
      4000
    );
  }
}

// Test reference values:
Test.equal(12, ReedSolomon.Galois.multiply(3, 4), 'Galois', 'multiply(3, 4)');
Test.equal(21, ReedSolomon.Galois.multiply(7, 7), 'Galois', 'multiply(7, 7)');
Test.equal(41, ReedSolomon.Galois.multiply(23, 45), 'Galois', 'multiply(23, 45)');
Test.equal(4, ReedSolomon.Galois.exp(2, 2), 'Galois', 'exp(2, 2)');
Test.equal(235, ReedSolomon.Galois.exp(5, 20), 'Galois', 'exp(5, 20)');
Test.equal(43, ReedSolomon.Galois.exp(13, 7), 'Galois', 'exp(13, 7)');

var random = (function() {
	return Math.random();
}());

var generateShard = function(shardSize) {
  var buffer = new Buffer(shardSize);
  var length = shardSize;
  if (random() < 0.05) {
    while (length--) buffer[length] = 0;
  } else if (random() < 0.05) {
    while (length--) buffer[length] = 255;
  } else {
    while (length--) buffer[length] = Math.round(random() * 255);
  }
  return buffer;
};

var hashShard = function(buffer) {
  var hash = Node.crypto.createHash('SHA256');
  hash.update(buffer);
  return hash.digest('hex').slice(0, 128 / 8 * 2); // Truncate hash to 128 bits.
};

var corruptShard = function(shard, offset, size) {
  var seen = {};
  var times = Math.min(
    size,
    Math.max(
      1,
      Math.round(random() * Math.min(10, size))
    )
  );
  while (times) {
    var position = Math.min(size - 1, Math.round(random() * size));
    if (seen.hasOwnProperty(position)) continue;
    var source = shard[offset + position];
    var target = (source + Math.floor(random() * 256)) & 255;
    if (target !== source) {
      shard[offset + position] = target;
      seen[position] = true;
      times--;
    }
  }
};

var reinstantiateInstance = function(rs, dataShards, parityShards, binding) {
  if (random() < 0.8) return rs;
  Test.equal(true, true, 'ReedSolomon', 'reinstantiated instance');
  return new ReedSolomon(dataShards, parityShards, binding);
};

var fuzz = function(maxShards, maxShardSize, binding) {
  var minShards = 1;
  var minShardSize = 1;
  if (binding === ReedSolomon.bindingNative) {
    var bindingType = 'Native';
  } else {
    var bindingType = 'Javascript';
  }
  Test.equal(bindingType, bindingType, 'ReedSolomon', 'binding');
  // Generate Reed Solomon parameters:
  var totalShards = Math.max(
    minShards + 1,
    Math.round(random() * maxShards)
  );
  var dataShards = Math.max(
    minShards,
    Math.round(random() * (totalShards - 1))
  );
  var parityShards = totalShards - dataShards;
  Test.equal(
    totalShards <= 256,
    true,
    'ReedSolomon',
    'totalShards=' + totalShards
  );
  Test.equal(
    dataShards >= 1,
    true,
    'ReedSolomon',
    'dataShards=' + dataShards
  );
  Test.equal(
    parityShards >= 1,
    true,
    'ReedSolomon',
    'parityShards=' + parityShards
  );
  if (random() < 0.01) {
    var shardSize = minShardSize;
  } else {
    var shardSize = Math.max(
      minShardSize,
      Math.round(random() * maxShardSize)
    );
  }
  Test.equal(
    shardSize >= minShardSize && shardSize <= maxShardSize,
    true,
    'ReedSolomon',
    'shardSize=' + shardSize
  );
  if (random() < 0.2) {
    var offset = 0;
  } else {
    var offset = Math.min(shardSize - 1, Math.round(random() * shardSize));
  }
  Test.equal(
    offset >= 0 && offset < shardSize,
    true,
    'ReedSolomon',
    'offset=' + offset
  );
  var remaining = shardSize - offset;
  if (random() < 0.2) {
    var size = remaining;
  } else {
    var size = Math.min(remaining, Math.round(random() * remaining));
    if (size < 1) size = 1;
  }
  Test.equal(
    size > 0 && offset + size <= shardSize,
    true,
    'ReedSolomon',
    'size=' + size
  );
  // Create data shards, initialize parity shards and hash data shards:
  var shards = new Array(totalShards);
  var hashes = new Array(totalShards);
  for (var index = 0; index < dataShards; index++) {
    shards[index] = generateShard(shardSize); // Data shard.
    hashes[index] = hashShard(shards[index]);
  }
  for (var index = dataShards; index < totalShards; index++) {
    shards[index] = generateShard(shardSize); // Parity shard.
  }
  var rs = new ReedSolomon(dataShards, parityShards, binding);
  // Encode parity shards:
  rs.encode(shards, offset, size);
  // Check that shards were not corrupted by encode():
  for (var index = 0; index < dataShards; index++) {
    Test.equal(
      hashShard(shards[index]),
      hashes[index],
      'ReedSolomon',
      'shard ' + (index + 1) + '/' + totalShards + ' after encoding'
    );
  }
  // Capture parity hashes:
  for (var index = dataShards; index < totalShards; index++) {
    hashes[index] = hashShard(shards[index]);
  }
  // Occasionally switch to a new instance:
  rs = reinstantiateInstance(rs, dataShards, parityShards, binding);
  // Check isParityCorrect() is working for valid shards:
  var parityTemp = new Buffer(shardSize);
  Test.equal(
    rs.isParityCorrect(shards, offset, size, parityTemp),
    true,
    'ReedSolomon',
    'isParityCorrect'
  );
  // Check that shards were not corrupted by isParityCorrect():
  for (var index = 0; index < totalShards; index++) {
    Test.equal(
      hashShard(shards[index]),
      hashes[index],
      'ReedSolomon',
      'shard ' + (index + 1) + '/' + totalShards + ' after checking parity'
    );
  }
  // Decide how many shards to corrupt:
  var corruptShardsCount = Math.max(1, Math.round(random() * parityShards));
  Test.equal(
    corruptShardsCount >= 1 && corruptShardsCount <= parityShards,
    true,
    'ReedSolomon',
    'corruptShardsCount=' + corruptShardsCount
  );
  // Choose these shards randomly from data and parity shards:
  var corruptShards = new Array(totalShards);
  for (var index = 0; index < totalShards; index++) {
    corruptShards[index] = index;
  }
  var order = {};
  corruptShards.sort(
    function(a, b) {
      var key = a < b ? (a + '.' + b) : (b + '.' + a);
      if (!order.hasOwnProperty(key)) {
        order[key] = random() < 0.5 ? -1 : 1;
      }
      return order[key];
    }
  );
  var corrupt = {};
  for (var index = 0; index < corruptShardsCount; index++) {
    corrupt[corruptShards[index]] = true;
  }
  // Corrupt shards and update present array:
  var present = new Array(totalShards);
  for (var index = 0; index < totalShards; index++) {
    if (corrupt.hasOwnProperty(index)) {
      present[index] = false;
      corruptShard(shards[index], offset, size);
    } else {
      present[index] = true;
    }
  }
  // Occasionally switch to a new instance:
  rs = reinstantiateInstance(rs, dataShards, parityShards, binding);
  // Check isParityCorrect() is working for corrupt shards:
  Test.equal(
    rs.isParityCorrect(shards, offset, size, parityTemp),
    false,
    'ReedSolomon',
    'isParityCorrect'
  );
  // Decode corrupted shards:
  rs.decode(shards, offset, size, present);
  // Check that shards were not corrupted by isParityCorrect():
  for (var index = 0; index < totalShards; index++) {
    Test.equal(
      hashShard(shards[index]),
      hashes[index],
      'ReedSolomon',
      'shard ' + (index + 1) + '/' + totalShards + ' after decoding'
    );
  }
  // Check isParityCorrect() is working for valid shards:
  Test.equal(
    rs.isParityCorrect(shards, offset, size, parityTemp),
    true,
    'ReedSolomon',
    'isParityCorrect'
  );
};

var bindings = [ReedSolomon.bindingJS];
if (ReedSolomon.bindingNative) {
  bindings.push(ReedSolomon.bindingNative);
}
bindings.forEach(
  function(binding) {
    // Do many small tests:
    var tests = 100;
    while (tests--) fuzz(256, 1024, binding); // (maxShards, maxShardSize)
    // Do some large tests:
    var tests = 10;
    while (tests--) fuzz(32, 1024 * 1024, binding); // (maxShards, maxShardSize)
  }
);

console.log('================');
console.log('ALL TESTS PASSED');
console.log('================');
