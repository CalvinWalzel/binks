# binks

Binks is an (opinionated) test runner for rspec & cucumber.

## Usage

```bash
pnpx binks
```
Of course, `npx` can also be used instead.

By default, binks watches your `./features` & `./spec/` folders for changes in `.feature` & `*_spec.rb` files. If any are detected, it runs the file. If the file contains a `@focus` tag or `focus: true`, it scopes to these tests. If any other file is changed while a test is running, that change is __not__ queued. If a focus is removed, the test is also not run again. If you swap git branches, binks should also ignore it.

The test runner can be stopped with `CTRL + C` or by entering `:quit` or `:exit`.

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## Licence
[MIT](https://choosealicense.com/licenses/mit/)
