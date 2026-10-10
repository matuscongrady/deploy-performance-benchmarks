// This caller invokes the unmodified runtime from the pinned SST source tree.
// It is a benchmark bridge, not a standalone command offered by SST.
package main

import (
 "context"
 "encoding/json"
 "fmt"
 "os"
 "path/filepath"
 "sync"

 "github.com/sst/sst/v3/pkg/runtime"
 "github.com/sst/sst/v3/pkg/runtime/node"
)

func main() {
 var inputs []runtime.BuildInput
 if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { fail(err) }
 if len(inputs) == 0 { fail(fmt.Errorf("no function inputs")) }
 cfg, err := filepath.Abs("sst.config.ts"); if err != nil { fail(err) }
 collection := runtime.NewCollection(cfg, node.New("4.17.2"))
 results := make([]*runtime.BuildOutput, len(inputs))
 failures := make([]error, len(inputs))
 var wg sync.WaitGroup
 var outputLock sync.Mutex
 encoder := json.NewEncoder(os.Stdout)
 for i := range inputs {
  inputs[i].CfgPath = cfg
  wg.Add(1)
  go func(i int) {
   defer wg.Done()
   results[i], failures[i] = collection.Build(context.Background(), &inputs[i])
   if failures[i] == nil && len(results[i].Errors) == 0 {
    outputLock.Lock()
    failures[i] = encoder.Encode(struct { Index int `json:"index"`; Output *runtime.BuildOutput `json:"output"` }{i,results[i]})
    outputLock.Unlock()
   }
  }(i)
 }
 wg.Wait()
 for i, err := range failures {
  if err != nil { fail(fmt.Errorf("%s: %w", inputs[i].FunctionID, err)) }
  if len(results[i].Errors) > 0 { fail(fmt.Errorf("%s: %v", inputs[i].FunctionID, results[i].Errors)) }
 }
}
func fail(err error) { fmt.Fprintln(os.Stderr,err); os.Exit(1) }
