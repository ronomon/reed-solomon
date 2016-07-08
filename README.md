# reed-solomon
Reed-Solomon erasure coding in pure Javascript. A Javascript port of the [JavaReedSolomon](https://github.com/Backblaze/JavaReedSolomon) library released by [Backblaze](http://backblaze.com). Special thanks to [Backblaze](http://backblaze.com). For an introduction to erasure coding, see the post by Brian Beach on the [Backblaze blog](https://www.backblaze.com/blog/reed-solomon/) as well as his [video](https://youtu.be/jgO09opx56o).

## License
`reed-solomon` is licensed under the [MIT License](https://en.wikipedia.org/wiki/MIT_License), which means that you can use it in your own projects for free. You can even use it in commercial projects.

## Installation
```
npm install reed-solomon
```

## Usage
### Encoding
```
var ReedSolomon = require('reed-solomon');
var dataShards = 6;
var parityShards = 3;
var shardSize = 1024;
var shards = [
  // Data shards (containing user data):
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize),
  // Parity shards (zero-filled or not containing any parity data):
  new Buffer(shardSize),
  new Buffer(shardSize),
  new Buffer(shardSize)
];
var rs = new ReedSolomon(dataShards, parityShards);
rs.encodeParity(shards, 0, shardSize);
// Parity shards will now contain parity data.
```
