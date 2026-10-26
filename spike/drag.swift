// Real OS drag: swift drag.swift x y dx dy, then puts the cursor back.
import CoreGraphics
import Foundation
let a = CommandLine.arguments.dropFirst().map { Double($0)! }
let start = CGPoint(x: a[0], y: a[1]), saved = CGEvent(source: nil)!.location
func post(_ t: CGEventType, _ p: CGPoint) { CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap); usleep(25000) }
post(.mouseMoved, start); usleep(150000)
post(.leftMouseDown, start); usleep(150000)
for i in 1...20 { post(.leftMouseDragged, CGPoint(x: start.x + a[2] * Double(i) / 20, y: start.y + a[3] * Double(i) / 20)) }
post(.leftMouseUp, CGPoint(x: start.x + a[2], y: start.y + a[3]))
CGWarpMouseCursorPosition(saved)
