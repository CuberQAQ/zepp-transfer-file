# transfer-file

Polyfill of @zos/ble/transfer-file API for ZeppOS 2.0/2.1 device.

Corrently not support segmented download, "progress" event or cancel sending task.

Some api were not tested. I don't know whether it could work correctly.

## 1. Install

Use Command `npm i @cuberqaq/transfer-file --save` to install transfer-file in your ZeppOS Miniapp project.

## 2. Import & Use

In your app-side JavaScript source file, use this to import transfer-file:

```js
import { TransferFile } from "@cuberqaq/transfer-file";
```

Then you can use the methods in the same way you do with @zos/fs module. API Document see [Zepp OS Developers Documentation](https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/)

## 3. Example:

Receiving File:

```js
import { TransferFile } from "@cuberqaq/transfer-file";

const transferFile = new TransferFile()
const inbox = transferFile.getInbox()

Page({
  onInit() {
    inbox.on('NEWFILE', function() {
      const fileObject = inbox.getNextFile()

      fileObject.on('change', (event) => {
        if (event.data.readyState === 'transferred') {
          console.log('transfered file success')
        } else (event.data.readyState === 'error') {
          console.log('error')
        }
      })
    })
  }
})
```

Send File:

```js
import { TransferFile } from "@cuberqaq/transfer-file";

const transferFile = new TransferFile()
const outbox = transferFile.getOutbox()

Page({
  onInit() {
    const fileObject = outbox.enqueueFile("assets://logo.png", { test: 1})

    fileObject.on('change', (event) => {
      if (event.data.readyState === 'transferred') {
        console.log('transfered file success')
      } else (event.data.readyState === 'error') {
        console.log('error')
      }
    })
  }
})
```
