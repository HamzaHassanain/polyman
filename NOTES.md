# Notes Regarding Windows Users

## When using this project on Windows, please be aware of the following considerations:

### Line Endings:

Windows uses different line endings (CRLF) compared to Unix-based systems (LF). Ensure your text editor is configured to handle line endings appropriately to avoid issues in scripts and configuration files.

#### UNIX

```json
{
  "tests": [
    {
      "input": "5 10\n1 2 3 4 5\n",
      "expectedVerdict": "VALID"
    },
    {
      "input": "0 0\n\n",
      "expectedVerdict": "INVALID"
    }
  ]
}
```

#### WINDOWS

```json
{
  "tests": [
    {
      "input": "5 10\r\n1 2 3 4 5\r\n",
      "expectedVerdict": "VALID"
    },
    {
      "input": "0 0\r\n\r\n",
      "expectedVerdict": "INVALID"
    }
  ]
}
```

#### Notes About The `TUTORIAL.md` File

We always use Unix-style line endings (LF) in the `TUTORIAL.md` file to maintain consistency across different operating systems. If you are using Windows, please ensure your text editor can handle LF line endings correctly to avoid any formatting issues.

**PLEASE REPORT ANY ISSUES YOU ENCOUNTER WHILE USING THIS PROJECT ON WINDOWS. YOUR FEEDBACK IS VALUABLE TO US!**

### File Paths:

Windows uses backslashes (`\`) for file paths, while Unix-based systems use forward slashes (`/`). Be cautious when specifying file paths in scripts or configuration files to ensure compatibility.

```json
{
  "filePath": "C:\\Users\\Username\\Documents\\project\\file.txt"
}
```

### Solutions, Validators, Generators, and Checkers That Exceed The Time Limit:

I had a hard time trying to ensure the proper cleanup of the processes terminated duo to time limit exceeded on Windows,
Most of the time, you will find that the processes are not being killed properly, leading to resource leaks and other unexpected behavior.

That is most of the time you will recive that error saying something like:

```
EBUSY: resource busy or locked, open 'C:\Users\hamza\sum-problem\solutions-outputs\tlee\tests\output_test1.txt'
```

This error mostly happens while wrting to files that are being used by another process (the one that was not killed properly).

For such cases, open your Task Manager and manually kill the processes that are still running, search for the name of the executable you were trying to run (that is the name of your solution, validator, generator, or checker executable).

#### Compilation Errors ALSO MAY HAPPEN DUE TO THE SAME REASON

If you face compilation errors that you are sure are not related to your code, try to manually kill the processes as mentioned above, and then try to recompile.

## Notes Regarding Polygon

I found no way to disable the automatic update of the checker, so it will give you a warning (when useing a standard checker). You may need to consider doing that manually if you want to avoid that warning.

## Notes Regarding The Validators new line.

Please keep in mind that on Windows, the new line character is represented by a carriage return followed by a line feed (`\r\n`), while on Unix-based systems, it is represented by just a line feed (`\n`). Also keep in mind that some code editors will use `\n` even on Windows.

So when you write a manual test case for your validator, make sure to use the correct new line character based on the operating system you are using.

Best option is to use the windows Text Editor (the built-in one) to write your test cases, as it will use the correct new line characters for your OS.
