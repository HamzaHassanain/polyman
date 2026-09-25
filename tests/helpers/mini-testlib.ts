/**
 * A miniature testlib.h with each construct the splitter has to handle, in
 * testlib's own style.
 */
export const MINI_TESTLIB = String.raw`#ifndef _TESTLIB_H_
#define _TESTLIB_H_

#define VERSION "0.9.99"
#include <cstdio>
#include <functional>
#include <string>

/* Braces in comments { and "quotes" are not code. */
static char __buffer[16];
static int __usage = 0;
int __exitCode;
const int MAX_CASE = 100;
const char *features[] = {"a", "b{"};
std::function<int(int)> __scorer;

#define FMT(x) do { x; } while (0)

#ifdef __GNUC__
__attribute__((const))
#endif
static inline int twice(int x) { return 2 * x; }

template<typename T>
static T identity(const T &x) { return x; }

static int nextId() {
    static int id = 0;
#ifdef NEVER_DEFINED
    if (id < 0) {
        id = 0;
    }
#else
    if (id < 0) {
        id = 1;
    }
#endif
    return ++id;
}

inline int peekId() { return nextId() - 1; }

class random_t;

struct Counter {
    static int created;
    int value;
    Counter();
    int next() { return ++value; }
    int get() const;
};

int Counter::created = 0;

Counter::Counter() : value(0) {
    created++;
}

#ifdef __GNUC__
__attribute__((pure))
#endif
int Counter::get() const { return value; }

class Registry {
public:
    int size() const;
} registry;

int Registry::size() const { return 1; }

template<typename T>
T parse(const std::string &s);

template<>
#ifdef __GNUC__
__attribute__((pure))
#endif
int parse<int>(const std::string &s) { return (int) s.size(); }

void quit(const char *message = "bye") {
    std::printf("%s\n", message);
}

#endif
`;
